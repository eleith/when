import type { Kysely } from 'kysely';
import { resolveBookingActions } from './actions';
import { recordNotificationFailure } from './notifications';
import { transitionStatus } from './status';
import type { Clock } from '../clock';
import type { WhenConfiguration } from '@when/config';
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
		{
			id: input.appointment.id,
			from: ['pending'],
			to: 'declined',
			patch: { notification_status: null }
		}
	);
	if (!transition.ok) return { ok: false, reason: 'conflict' };

	const row = transition.row;

	// Decline never has a calendar effect — pending bookings aren't pushed.

	const emailed = await sendEmails(
		deps.cfg,
		bookingDeclined({ cfg: deps.cfg, appointment: row, eventType })
	);
	if (!emailed.ok) {
		await recordNotificationFailure(deps.db, row.id, 'email');
		return { ok: true, appointment: { ...row, notification_status: '{"email":"failed"}' } };
	}

	return { ok: true, appointment: row };
}
