import { sql, type Kysely } from 'kysely';
import type { Appointment, Database } from '@when/db';

export type TransitionOutcome = { ok: true } | { ok: false; reason: 'conflict' | 'not_found' };

export type RescheduleResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'conflict' };

// `numUpdatedRows === 0` means the guarded `where status in (...)` matched nothing:
// either the row is gone (not_found) or someone else moved it first (conflict).
async function classify(
	db: Kysely<Database>,
	id: string,
	numUpdatedRows: bigint
): Promise<TransitionOutcome> {
	if (numUpdatedRows > 0n) return { ok: true };
	const exists = await db
		.selectFrom('appointments')
		.select('id')
		.where('id', '=', id)
		.executeTakeFirst();
	return { ok: false, reason: exists ? 'conflict' : 'not_found' };
}

/** Accept a pending booking. The worker then creates its calendar event. */
export async function confirmBooking(db: Kysely<Database>, id: string): Promise<TransitionOutcome> {
	const result = await db
		.updateTable('appointments')
		.set({
			status: 'confirmed',
			email_notification_status: null,
			calendar_push_notification_status: 'queued',
			calendar_revision: sql`calendar_revision + 1`,
			updated_at: sql`CURRENT_TIMESTAMP`
		})
		.where('id', '=', id)
		.where('status', 'in', ['pending'])
		.executeTakeFirst();
	return classify(db, id, result.numUpdatedRows);
}

/**
 * Reschedule = end the current occurrence (status → `rescheduled`) and create a linked new one
 * at the new time. The new row inherits the calendar event pointer and `origin_id`, so the
 * published event just moves (the worker patches it) instead of being deleted and recreated.
 * A slot-uniqueness violation (the new slot was taken) surfaces as a thrown UNIQUE error for the
 * caller to map to `slot_taken`; an old row that's no longer active resolves to `conflict`.
 */
export async function rescheduleBooking(
	db: Kysely<Database>,
	old: Appointment,
	when: { newStart: string; newEnd: string }
): Promise<RescheduleResult> {
	const newId = `appt-${crypto.randomUUID()}`;
	const newToken = `tok-${crypto.randomUUID()}`;

	const created = await db.transaction().execute(async (trx) => {
		const terminated = await trx
			.updateTable('appointments')
			.set({
				status: 'rescheduled',
				rescheduled_to_id: newId,
				updated_at: sql`CURRENT_TIMESTAMP`
			})
			.where('id', '=', old.id)
			.where('status', 'in', ['pending', 'confirmed'])
			.executeTakeFirst();
		// 0 rows: the old booking is no longer active (raced to terminal) — commit nothing.
		if (terminated.numUpdatedRows === 0n) return null;

		return await trx
			.insertInto('appointments')
			.values({
				id: newId,
				event_type_id: old.event_type_id,
				start_time: when.newStart,
				end_time: when.newEnd,
				attendee_name: old.attendee_name,
				attendee_email: old.attendee_email,
				attendee_notes: old.attendee_notes,
				attendee_timezone: old.attendee_timezone,
				location: old.location,
				status: old.status,
				origin_id: old.origin_id ?? old.id,
				rescheduled_from_id: old.id,
				cancel_token: newToken,
				// Inherit the event pointer so the worker patches the same event, not a new one.
				external_event_id: old.external_event_id,
				external_calendar_id: old.external_calendar_id,
				calendar_push_notification_status: old.status === 'confirmed' ? 'queued' : null,
				ics_sequence: old.ics_sequence + 1
			})
			.returningAll()
			.executeTakeFirstOrThrow();
	});

	if (!created) return { ok: false, reason: 'conflict' };
	return { ok: true, appointment: created };
}

/** Cancel a booking. The worker deletes its event if one was published. */
export async function cancelBooking(db: Kysely<Database>, id: string): Promise<TransitionOutcome> {
	const result = await db
		.updateTable('appointments')
		.set({
			status: 'cancelled',
			ics_sequence: sql`ics_sequence + 1`,
			email_notification_status: null,
			// Only worth a sync when there's an event to remove.
			calendar_push_notification_status: sql`CASE WHEN external_event_id IS NOT NULL THEN 'queued' ELSE NULL END`,
			calendar_revision: sql`calendar_revision + 1`,
			updated_at: sql`CURRENT_TIMESTAMP`
		})
		.where('id', '=', id)
		.where('status', 'in', ['pending', 'confirmed'])
		.executeTakeFirst();
	return classify(db, id, result.numUpdatedRows);
}

/** Decline a pending request. It was never on the calendar, so no revision bump. */
export async function declineBooking(db: Kysely<Database>, id: string): Promise<TransitionOutcome> {
	const result = await db
		.updateTable('appointments')
		.set({
			status: 'declined',
			email_notification_status: null,
			calendar_push_notification_status: null,
			updated_at: sql`CURRENT_TIMESTAMP`
		})
		.where('id', '=', id)
		.where('status', 'in', ['pending'])
		.executeTakeFirst();
	return classify(db, id, result.numUpdatedRows);
}
