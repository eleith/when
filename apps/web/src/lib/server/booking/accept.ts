import type { Kysely } from 'kysely';
import { resolveBookingActions } from './actions';
import { bookingLinks } from './links';
import { enqueueBookingEmail } from '../workflow';
import { transitionStatus } from './status';
import { pushAppointment } from '../calendar/push';
import type { Clock } from '../clock';
import type { WhenConfiguration } from '@when/config';
import type { Appointment, Database, NotificationOutcome } from '@when/db';

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

	const transition = await transitionStatus(
		{ db: deps.db, clock: deps.clock },
		{
			id: input.appointment.id,
			from: ['pending'],
			to: 'confirmed',
			patch: { email_notification_status: null, calendar_push_notification_status: null }
		}
	);
	if (!transition.ok) return { ok: false, reason: 'conflict' };

	let row = transition.row;
	const links = bookingLinks({ baseUrl: input.baseUrl, appointment: row, eventType });

	let externalUpdate: { external_event_id: string; external_calendar_id: string } | null = null;
	let calendarPush: NotificationOutcome | null = null;

	if (eventType) {
		const pushed = await pushAppointment(deps.cfg, row, eventType.destination_calendar, {
			cancelUrl: links.booked
		});
		if (pushed.ok) {
			externalUpdate = {
				external_event_id: pushed.externalEventId,
				external_calendar_id: pushed.externalCalendarId
			};
			calendarPush = 'ok';
		} else {
			calendarPush = 'failed';
		}
	}

	await deps.db
		.updateTable('appointments')
		.set({
			...(externalUpdate ?? {}),
			calendar_push_notification_status: calendarPush,
			updated_at: deps.clock.now().toISOString()
		})
		.where('id', '=', row.id)
		.execute();
	row = { ...row, ...(externalUpdate ?? {}), calendar_push_notification_status: calendarPush };

	const appointment = await enqueueBookingEmail(deps.db, {
		kind: 'confirmed',
		appointment: row,
		eventType,
		links
	});

	return { ok: true, appointment };
}
