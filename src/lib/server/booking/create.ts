import type { Kysely } from 'kysely';
import { bookingLinks } from './links';
import { createNotificationTracker } from './side-effects';
import { pushAppointment } from '../calendar/push';
import type { Clock } from '../clock';
import type { EventType, WhenConfiguration } from '../config/schema';
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
	/** Origin (e.g. `https://when.example.com`) used to build URLs in notify ctx. */
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

/**
 * Insert a new booking and fire its creation side effects (calendar push +
 * notifications). The caller is responsible for validating that the slot is
 * available; a concurrent grab surfaces as `{ ok: false, reason: 'slot_taken' }`.
 */
export async function createAppointment(
	deps: CreateAppointmentDeps,
	input: CreateAppointmentInput
): Promise<CreateAppointmentResult> {
	const { db, cfg, clock } = deps;
	const { eventType } = input;

	const status: 'pending' | 'confirmed' =
		eventType.booking_flow === 'requires_confirmation' ? 'pending' : 'confirmed';
	const id = crypto.randomUUID();
	const cancelToken = crypto.randomUUID();

	let appointment: Appointment = {
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
		notification_status: null,
		ics_sequence: 0,
		created_at: '',
		updated_at: ''
	};

	try {
		await db
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
			.execute();
	} catch (err) {
		if (isUniqueViolation(err)) return { ok: false, reason: 'slot_taken' };
		throw err;
	}

	const links = bookingLinks({ baseUrl: input.baseUrl, appointment, eventType });

	const tracker = createNotificationTracker(null);
	let externalUpdate: { external_event_id: string; external_calendar_id: string } | null = null;

	if (status === 'confirmed') {
		const pushed = await tracker.run('calendar_push', () =>
			pushAppointment(cfg, appointment, eventType.destination_calendar, { cancelUrl: links.booked })
		);
		if (pushed.ok) {
			externalUpdate = {
				external_event_id: pushed.externalEventId,
				external_calendar_id: pushed.externalCalendarId
			};
		}
		await tracker.run('email', () =>
			sendEmails(cfg, bookingConfirmed({ cfg, appointment, eventType, baseUrl: input.baseUrl }))
		);
	} else {
		await tracker.run('email', async () => {
			const args = { cfg, appointment, eventType, baseUrl: input.baseUrl };
			const [organizer, attendee] = await Promise.all([
				sendEmails(cfg, bookingPendingToOrganizer(args)),
				sendEmails(cfg, bookingPendingToAttendee(args))
			]);
			return { ok: organizer.ok && attendee.ok };
		});
	}

	if (externalUpdate !== null || tracker.changed()) {
		await db
			.updateTable('appointments')
			.set({
				...(externalUpdate ?? {}),
				notification_status: tracker.status(),
				updated_at: clock.now().toISOString()
			})
			.where('id', '=', id)
			.execute();
		appointment = {
			...appointment,
			...(externalUpdate ?? {}),
			notification_status: tracker.status()
		};
	}

	return { ok: true, appointment };
}
