import type { Kysely } from 'kysely';
import { resolveBookingActions, type Viewer } from './actions';
import { enqueueBookingEmail, enqueueCalendarSync } from '../workflow';
import { transitionStatus } from './status';
import type { Clock } from '../clock';
import type { WhenConfiguration } from '@when/config';
import type { Appointment, Database } from '@when/db';

export interface CancelAppointmentDeps {
	db: Kysely<Database>;
	cfg: WhenConfiguration;
	clock: Clock;
}

export interface CancelAppointmentInput {
	appointment: Appointment;
	initiator: Viewer;
	/** Origin (e.g. `https://when.example.com`) used to build URLs in notify ctx. */
	baseUrl: string;
}

export type CancelAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'conflict' };

export async function cancelAppointment(
	deps: CancelAppointmentDeps,
	input: CancelAppointmentInput
): Promise<CancelAppointmentResult> {
	const eventType = deps.cfg.event_types.find((e) => e.id === input.appointment.event_type_id);

	const gate = resolveBookingActions({
		row: input.appointment,
		viewer: input.initiator,
		now: deps.clock.now(),
		eventType
	}).cancel;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	// A booking with a calendar event needs it deleted; bump the revision and
	// queue it. One that was never synced just settles to in-sync on the scan.
	const transition = await transitionStatus(
		{ db: deps.db, clock: deps.clock },
		{
			id: input.appointment.id,
			from: ['pending', 'confirmed'],
			to: 'cancelled',
			patch: {
				ics_sequence: input.appointment.ics_sequence + 1,
				email_notification_status: null,
				calendar_push_notification_status: input.appointment.external_event_id ? 'queued' : null
			},
			bumpCalendarRevision: true
		}
	);
	if (!transition.ok) return { ok: false, reason: 'conflict' };

	const kind = input.initiator === 'organizer' ? 'cancelled-by-organizer' : 'cancelled-by-attendee';
	const appointment = await enqueueBookingEmail(deps.db, {
		kind,
		appointment: transition.row,
		eventType
	});
	await enqueueCalendarSync();

	return { ok: true, appointment };
}
