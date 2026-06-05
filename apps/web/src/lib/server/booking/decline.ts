import type { Kysely } from 'kysely';
import { resolveBookingActions } from './actions';
import { bookingLinks } from './links';
import { enqueueBookingEmail } from '../workflow';
import { transitionStatus } from './status';
import type { Clock } from '../clock';
import type { WhenConfiguration } from '@when/config';
import type { Appointment, Database } from '@when/db';

export interface DeclineAppointmentDeps {
	db: Kysely<Database>;
	cfg: WhenConfiguration;
	clock: Clock;
}

export interface DeclineAppointmentInput {
	appointment: Appointment;
	baseUrl: string;
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
			patch: { email_notification_status: null, calendar_push_notification_status: null }
		}
	);
	if (!transition.ok) return { ok: false, reason: 'conflict' };

	const row = transition.row;

	// Decline never has a calendar effect — pending bookings aren't pushed.
	const notify = {
		email_notification_status: 'queued' as const,
		calendar_push_notification_status: null
	};

	await deps.db
		.updateTable('appointments')
		.set({ ...notify, updated_at: deps.clock.now().toISOString() })
		.where('id', '=', row.id)
		.execute();

	const appointment = { ...row, ...notify };
	const links = bookingLinks({ baseUrl: input.baseUrl, appointment, eventType });
	await enqueueBookingEmail({ kind: 'declined', appointment, eventType, links });

	return { ok: true, appointment };
}
