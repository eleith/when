import type { Kysely } from 'kysely';
import { bookingLinks } from './links';
import { recordNotificationFailure } from './notifications';
import { pushAppointment } from '../calendar/push';
import type { Clock } from '../clock';
import type { EventType, WhenConfiguration } from '@when/config';
import type { Appointment, Database } from '../db';
import { sendEmails } from '../email/send';
import { bookingConfirmed } from '../emails/booking-confirmed';
import { bookingPendingToAttendee } from '../emails/booking-pending-to-attendee';
import { bookingPendingToOrganizer } from '../emails/booking-pending-to-organizer';

export interface CreateAppointmentDeps {
	db: Kysely<Database>;
	cfg: WhenConfiguration;
	clock: Clock;
}

export interface CreateAppointmentInput {
	eventType: EventType;
	/** New start_time as ISO instant (caller has validated availability). */
	start: string;
	/** New end_time as ISO instant. */
	end: string;
	attendee: { name: string; email: string; notes: string | null };
	location: string | null;
	baseUrl: string;
}

export type CreateAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'slot_taken' };

function isUniqueViolation(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const msg = String((err as { message?: unknown }).message ?? '');
	return /UNIQUE constraint failed/i.test(msg);
}

export async function createAppointment(
	{ db, cfg, clock }: CreateAppointmentDeps,
	input: CreateAppointmentInput
): Promise<CreateAppointmentResult> {
	const id = `appt-${crypto.randomUUID()}`;
	const cancelToken = `tok-${crypto.randomUUID()}`;
	const eventType = input.eventType;
	const status = eventType.booking_flow === 'requires_confirmation' ? 'pending' : 'confirmed';

	let appointment: Appointment;
	try {
		appointment = await db
			.insertInto('appointments')
			.values({
				id,
				event_type_id: eventType.id,
				start_time: input.start,
				end_time: input.end,
				attendee_name: input.attendee.name,
				attendee_email: input.attendee.email,
				attendee_notes: input.attendee.notes,
				location: input.location,
				status,
				cancel_token: cancelToken,
				external_event_id: null,
				external_calendar_id: null,
				notification_status: null
			})
			.returningAll()
			.executeTakeFirstOrThrow();
	} catch (err) {
		if (isUniqueViolation(err)) return { ok: false, reason: 'slot_taken' };
		throw err;
	}

	const links = bookingLinks({ baseUrl: input.baseUrl, appointment, eventType });

	let externalUpdate: { external_event_id: string; external_calendar_id: string } | null = null;
	let notificationStatus: string | null = null;

	if (status === 'confirmed') {
		const pushed = await pushAppointment(cfg, appointment, eventType.destination_calendar, {
			cancelUrl: links.booked
		});
		if (pushed.ok) {
			externalUpdate = {
				external_event_id: pushed.externalEventId,
				external_calendar_id: pushed.externalCalendarId
			};
		} else {
			await recordNotificationFailure(db, id, 'calendar_push');
			notificationStatus = '{"calendar_push":"failed"}';
		}
		const emailed = await sendEmails(
			cfg,
			bookingConfirmed({ cfg, appointment, eventType, baseUrl: input.baseUrl })
		);
		if (!emailed.ok) {
			await recordNotificationFailure(db, id, 'email');
			notificationStatus = notificationStatus
				? '{"calendar_push":"failed","email":"failed"}'
				: '{"email":"failed"}';
		}
	} else {
		const args = { cfg, appointment, eventType, baseUrl: input.baseUrl };
		const [organizer, attendee] = await Promise.all([
			sendEmails(cfg, bookingPendingToOrganizer(args)),
			sendEmails(cfg, bookingPendingToAttendee(args))
		]);
		if (!organizer.ok || !attendee.ok) {
			await recordNotificationFailure(db, id, 'email');
			notificationStatus = '{"email":"failed"}';
		}
	}

	if (externalUpdate !== null || notificationStatus !== null) {
		await db
			.updateTable('appointments')
			.set({
				...(externalUpdate ?? {}),
				notification_status: notificationStatus,
				updated_at: clock.now().toISOString()
			})
			.where('id', '=', id)
			.execute();
		appointment = {
			...appointment,
			...(externalUpdate ?? {}),
			notification_status: notificationStatus
		};
	}

	return { ok: true, appointment };
}
