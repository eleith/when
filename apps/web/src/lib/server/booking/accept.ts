import type { Kysely } from 'kysely';
import { resolveBookingActions } from './actions';
import { bookingLinks } from './links';
import { recordNotificationFailure } from './notifications';
import { transitionStatus } from './status';
import { pushAppointment } from '../calendar/push';
import type { Clock } from '../clock';
import type { WhenConfiguration } from '../config/schema';
import type { Appointment, Database } from '../db';
import { sendEmails } from '../email/send';
import { bookingConfirmed } from '../emails/booking-confirmed';

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
			patch: { notification_status: null }
		}
	);
	if (!transition.ok) return { ok: false, reason: 'conflict' };

	let row = transition.row;
	const links = bookingLinks({ baseUrl: input.baseUrl, appointment: row, eventType });

	let externalUpdate: { external_event_id: string; external_calendar_id: string } | null = null;
	let notificationStatus: string | null = null;

	if (eventType) {
		const pushed = await pushAppointment(deps.cfg, row, eventType.destination_calendar, {
			cancelUrl: links.booked
		});
		if (pushed.ok) {
			externalUpdate = {
				external_event_id: pushed.externalEventId,
				external_calendar_id: pushed.externalCalendarId
			};
		} else {
			await recordNotificationFailure(deps.db, row.id, 'calendar_push');
			notificationStatus = '{"calendar_push":"failed"}';
		}
	}

	const emailed = await sendEmails(
		deps.cfg,
		bookingConfirmed({ cfg: deps.cfg, appointment: row, eventType, baseUrl: input.baseUrl })
	);
	if (!emailed.ok) {
		await recordNotificationFailure(deps.db, row.id, 'email');
		notificationStatus = notificationStatus
			? '{"calendar_push":"failed","email":"failed"}'
			: '{"email":"failed"}';
	}

	if (externalUpdate !== null || notificationStatus !== null) {
		await deps.db
			.updateTable('appointments')
			.set({
				...(externalUpdate ?? {}),
				notification_status: notificationStatus,
				updated_at: deps.clock.now().toISOString()
			})
			.where('id', '=', row.id)
			.execute();
		row = { ...row, ...(externalUpdate ?? {}), notification_status: notificationStatus };
	}

	return { ok: true, appointment: row };
}
