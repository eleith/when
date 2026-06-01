import type { Kysely } from 'kysely';
import { resolveBookingActions, type Viewer } from './actions';
import { recordNotificationFailure } from './notifications';
import { transitionStatus } from './status';
import { deleteAppointmentFromCalendar } from '../calendar/push';
import type { Clock } from '../clock';
import type { WhenConfiguration } from '@when/config';
import type { Appointment, Database } from '@when/db';
import { bookingCancelledByAttendee } from '../emails/booking-cancelled-by-attendee';
import { bookingCancelledByOrganizer } from '../emails/booking-cancelled-by-organizer';
import { sendEmails } from '../email/send';

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
				notification_status: null
			}
		}
	);
	if (!transition.ok) return { ok: false, reason: 'conflict' };

	const cancelled = transition.row;
	let notificationStatus: string | null = null;

	if (cancelled.external_event_id && cancelled.external_calendar_id) {
		const deleted = await deleteAppointmentFromCalendar(
			deps.cfg,
			cancelled.external_calendar_id!,
			cancelled.external_event_id!
		);
		if (!deleted.ok) {
			await recordNotificationFailure(deps.db, cancelled.id, 'calendar_push');
			notificationStatus = '{"calendar_push":"failed"}';
		}
	}

	const builder =
		input.initiator === 'organizer' ? bookingCancelledByOrganizer : bookingCancelledByAttendee;
	const emailed = await sendEmails(
		deps.cfg,
		builder({ cfg: deps.cfg, appointment: cancelled, eventType, baseUrl: input.baseUrl })
	);
	if (!emailed.ok) {
		await recordNotificationFailure(deps.db, cancelled.id, 'email');
		notificationStatus = notificationStatus
			? '{"calendar_push":"failed","email":"failed"}'
			: '{"email":"failed"}';
	}

	return { ok: true, appointment: { ...cancelled, notification_status: notificationStatus } };
}
