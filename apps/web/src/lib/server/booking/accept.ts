import type { Kysely } from 'kysely';
import { resolveBookingActions } from './actions';
import { enqueueBookingEmail, enqueueCalendarSync } from '../workflow';
import { transitionStatus } from './status';
import type { Clock } from '../clock';
import type { WhenConfiguration } from '@when/config';
import type { Appointment, Database } from '@when/db';

export interface AcceptAppointmentDeps {
	db: Kysely<Database>;
	cfg: WhenConfiguration;
	clock: Clock;
}

export interface AcceptAppointmentInput {
	appointment: Appointment;
	baseUrl: string;
}

export type AcceptAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'conflict' };

export async function acceptAppointment(
	deps: AcceptAppointmentDeps,
	input: AcceptAppointmentInput
): Promise<AcceptAppointmentResult> {
	const eventType = deps.cfg.event_types.find((e) => e.id === input.appointment.event_type_id);

	const gate = resolveBookingActions({
		row: input.appointment,
		viewer: 'organizer',
		now: deps.clock.now(),
		eventType
	}).accept;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	// Bump the revision and queue the calendar sync; the worker creates the event.
	const transition = await transitionStatus(
		{ db: deps.db, clock: deps.clock },
		{
			id: input.appointment.id,
			from: ['pending'],
			to: 'confirmed',
			patch: { email_notification_status: null, calendar_push_notification_status: 'queued' },
			bumpCalendarRevision: true
		}
	);
	if (!transition.ok) return { ok: false, reason: 'conflict' };

	const appointment = await enqueueBookingEmail(deps.db, {
		kind: 'confirmed',
		appointment: transition.row,
		eventType
	});
	await enqueueCalendarSync();

	return { ok: true, appointment };
}
