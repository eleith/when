import type { Kysely } from 'kysely';
import { resolveBookingActions } from './actions';
import { createNotificationTracker } from './side-effects';
import { transitionStatus } from './status';
import type { Clock } from '../clock';
import type { WhenConfiguration } from '../config/schema';
import type { Appointment, Database } from '../db';
import { sendEmails } from '../email/send';
import { bookingDeclined } from '../emails/booking-declined';

export interface DeclineAppointmentDeps {
	db: Kysely<Database>;
	cfg: WhenConfiguration;
	clock: Clock;
}

export interface DeclineAppointmentInput {
	appointment: Appointment;
}

export type DeclineAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'conflict' };

export async function declineAppointment(
	deps: DeclineAppointmentDeps,
	input: DeclineAppointmentInput
): Promise<DeclineAppointmentResult> {
	const eventType = deps.cfg.event_types.find((e) => e.id === input.appointment.event_type_id);

	const gate = resolveBookingActions({
		row: input.appointment,
		viewer: 'organizer',
		now: deps.clock.now(),
		eventType
	}).decline;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	const transition = await transitionStatus(
		{ db: deps.db, clock: deps.clock },
		{ id: input.appointment.id, from: ['pending'], to: 'declined' }
	);
	if (!transition.ok) return { ok: false, reason: 'conflict' };

	const row = transition.row;
	const tracker = createNotificationTracker(row.notification_status);

	// Decline never has a calendar effect — pending bookings aren't pushed.

	await tracker.run('email', () =>
		sendEmails(deps.cfg, bookingDeclined({ cfg: deps.cfg, appointment: row, eventType }))
	);

	if (tracker.changed()) {
		await deps.db
			.updateTable('appointments')
			.set({ notification_status: tracker.status() })
			.where('id', '=', row.id)
			.execute();
	}

	return { ok: true, appointment: { ...row, notification_status: tracker.status() } };
}
