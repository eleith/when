import type { Kysely } from 'kysely';
import { bookingLinks } from './links';
import { enqueueBookingEmail } from '../workflow';
import { pushAppointment } from '../calendar/push';
import type { Clock } from '../clock';
import type { EventType, WhenConfiguration } from '@when/config';
import type { Appointment, Database, NotificationOutcome } from '@when/db';
import type { BookingEmailKind } from '@when/jobs';

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
				external_calendar_id: null
			})
			.returningAll()
			.executeTakeFirstOrThrow();
	} catch (err) {
		if (isUniqueViolation(err)) return { ok: false, reason: 'slot_taken' };
		throw err;
	}

	const links = bookingLinks({ baseUrl: input.baseUrl, appointment, eventType });

	let externalUpdate: { external_event_id: string; external_calendar_id: string } | null = null;
	let calendarPush: NotificationOutcome | null = null;
	const kind: BookingEmailKind = status === 'confirmed' ? 'confirmed' : 'pending';

	if (status === 'confirmed') {
		const pushed = await pushAppointment(cfg, appointment, eventType.destination_calendar, {
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

	const notify = {
		email_notification_status: 'queued' as const,
		calendar_push_notification_status: calendarPush
	};
	await db
		.updateTable('appointments')
		.set({ ...(externalUpdate ?? {}), ...notify, updated_at: clock.now().toISOString() })
		.where('id', '=', id)
		.execute();
	appointment = { ...appointment, ...(externalUpdate ?? {}), ...notify };

	await enqueueBookingEmail({ kind, appointment, eventType, links });

	return { ok: true, appointment };
}
