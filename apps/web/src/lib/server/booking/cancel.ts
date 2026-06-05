import type { Kysely } from 'kysely';
import { resolveBookingActions, type Viewer } from './actions';
import { bookingLinks } from './links';
import { enqueueBookingEmail } from '../workflow';
import { transitionStatus } from './status';
import { deleteAppointmentFromCalendar } from '../calendar/push';
import type { Clock } from '../clock';
import type { WhenConfiguration } from '@when/config';
import type { Appointment, Database, NotificationOutcome } from '@when/db';

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

	const transition = await transitionStatus(
		{ db: deps.db, clock: deps.clock },
		{
			id: input.appointment.id,
			from: ['pending', 'confirmed'],
			to: 'cancelled',
			patch: {
				ics_sequence: input.appointment.ics_sequence + 1,
				email_notification_status: null,
				calendar_push_notification_status: null
			}
		}
	);
	if (!transition.ok) return { ok: false, reason: 'conflict' };

	const cancelled = transition.row;
	let calendarPush: NotificationOutcome | null = null;

	if (cancelled.external_event_id && cancelled.external_calendar_id) {
		const deleted = await deleteAppointmentFromCalendar(
			deps.cfg,
			cancelled.external_calendar_id!,
			cancelled.external_event_id!
		);
		calendarPush = deleted.ok ? 'ok' : 'failed';
	}

	const notify = {
		email_notification_status: 'queued' as const,
		calendar_push_notification_status: calendarPush
	};

	await deps.db
		.updateTable('appointments')
		.set({ ...notify, updated_at: deps.clock.now().toISOString() })
		.where('id', '=', cancelled.id)
		.execute();

	const appointment = { ...cancelled, ...notify };
	const kind = input.initiator === 'organizer' ? 'cancelled-by-organizer' : 'cancelled-by-attendee';
	const links = bookingLinks({ baseUrl: input.baseUrl, appointment, eventType });
	await enqueueBookingEmail({ kind, appointment, eventType, links });

	return { ok: true, appointment };
}
