import { enqueueBookingEmail, enqueueCalendarSync } from '../workflow';
import type { BookingContext } from './context';
import type { EventType } from '@when/config';
import type { Appointment } from '@when/db';
import type { BookingEmailKind } from '@when/jobs';

export interface CreateAppointmentInput {
	eventType: EventType;
	/** New start_time as ISO instant (caller has validated availability). */
	start: string;
	/** New end_time as ISO instant. */
	end: string;
	attendee: { name: string; email: string; notes: string | null; timezone: string };
	location: string | null;
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
	ctx: BookingContext,
	input: CreateAppointmentInput
): Promise<CreateAppointmentResult> {
	const id = `appt-${crypto.randomUUID()}`;
	const cancelToken = `tok-${crypto.randomUUID()}`;
	const eventType = input.eventType;
	const status = eventType.booking_flow === 'requires_confirmation' ? 'pending' : 'confirmed';

	let appointment: Appointment;
	try {
		appointment = await ctx.db
			.insertInto('appointments')
			.values({
				id,
				event_type_id: eventType.id,
				start_time: input.start,
				end_time: input.end,
				attendee_name: input.attendee.name,
				attendee_email: input.attendee.email,
				attendee_notes: input.attendee.notes,
				attendee_timezone: input.attendee.timezone,
				location: input.location,
				status,
				origin_id: id,
				cancel_token: cancelToken,
				external_event_id: null,
				external_calendar_id: null,
				// A confirmed booking is out of sync (synced stays NULL) and the worker
				// syncs it to the calendar; a pending one isn't synced until accepted.
				calendar_push_notification_status: status === 'confirmed' ? 'queued' : null
			})
			.returningAll()
			.executeTakeFirstOrThrow();
	} catch (err) {
		if (isUniqueViolation(err)) return { ok: false, reason: 'slot_taken' };
		throw err;
	}

	const kind: BookingEmailKind = status === 'confirmed' ? 'confirmed' : 'pending';
	appointment = await enqueueBookingEmail(ctx.db, appointment.id, kind);
	if (status === 'confirmed') await enqueueCalendarSync();

	return { ok: true, appointment };
}
