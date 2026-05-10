import type { Kysely } from 'kysely';
import { resolveBookingActions, type Viewer } from './actions';
import { transitionStatus } from './status';
import { deleteAppointmentFromCalendar } from '../calendar/push';
import type { Clock } from '../clock';
import type { WhenConfiguration } from '../config/schema';
import type { Appointment, Database } from '../db';
import { mergeNotificationStatus } from '../db/notification-status';
import { notify } from '../notify';

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
			patch: { ics_sequence: input.appointment.ics_sequence + 1 }
		}
	);
	if (!transition.ok) return { ok: false, reason: 'conflict' };

	const cancelled = transition.row;
	let notif = cancelled.notification_status;

	if (cancelled.external_event_id && cancelled.external_calendar_id) {
		const result = await deleteAppointmentFromCalendar(
			deps.cfg,
			cancelled.external_calendar_id,
			cancelled.external_event_id
		);
		if (!result.ok) {
			notif = mergeNotificationStatus(notif, { calendar_push: 'failed' });
		}
	}

	// TODO project 03: switch variant on initiator (attendee vs organizer cancel).
	const cancelUrl = `${input.baseUrl}/booked/${cancelled.id}?token=${encodeURIComponent(
		cancelled.cancel_token
	)}`;
	const notifyResult = await notify('booking_cancelled_by_attendee', {
		cfg: deps.cfg,
		appointment: cancelled,
		eventType,
		cancelUrl
	});
	if (!notifyResult.ok) {
		notif = mergeNotificationStatus(notif, { email: 'failed' });
	}

	if (notif !== cancelled.notification_status) {
		await deps.db
			.updateTable('appointments')
			.set({ notification_status: notif })
			.where('id', '=', cancelled.id)
			.execute();
	}

	return { ok: true, appointment: { ...cancelled, notification_status: notif } };
}
