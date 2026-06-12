import { sql, type Kysely } from 'kysely';
import type { Database } from '@when/db';

export type TransitionOutcome = { ok: true } | { ok: false; reason: 'conflict' | 'not_found' };

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

/** Move a booking to a new time (status unchanged). The worker updates its event. */
export async function rescheduleBooking(
	db: Kysely<Database>,
	id: string,
	when: { newStart: string; newEnd: string }
): Promise<TransitionOutcome> {
	const result = await db
		.updateTable('appointments')
		.set({
			start_time: when.newStart,
			end_time: when.newEnd,
			ics_sequence: sql`ics_sequence + 1`,
			email_notification_status: null,
			calendar_push_notification_status: 'queued',
			calendar_revision: sql`calendar_revision + 1`,
			updated_at: sql`CURRENT_TIMESTAMP`
		})
		.where('id', '=', id)
		.where('status', 'in', ['pending', 'confirmed'])
		.executeTakeFirst();
	return classify(db, id, result.numUpdatedRows);
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
