import { sql, type Kysely } from 'kysely';
import type { Appointment, Database } from './types.js';

/**
 * The chain-root id of a booking: its own id, unless it descends from a reschedule.
 * Originals satisfy `origin_id === id`. Used as the stable calendar/ICS UID across a chain.
 */
export function originId(a: Pick<Appointment, 'id' | 'origin_id'>): string {
	return a.origin_id ?? a.id;
}

/** Fetch a single appointment by id (the full row), or undefined if none. */
export function findAppointment(
	db: Kysely<Database>,
	id: string
): Promise<Appointment | undefined> {
	return db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirst();
}

/**
 * The latest occurrence of a reschedule chain: the single row sharing an `origin_id` that was
 * never rescheduled further (`rescheduled_to_id IS NULL`). It's the live booking when active, or
 * the final state (cancelled/declined/expired) when the chain ended terminal.
 */
export function findChainTip(
	db: Kysely<Database>,
	chainOriginId: string
): Promise<Appointment | undefined> {
	return db
		.selectFrom('appointments')
		.selectAll()
		.where('origin_id', '=', chainOriginId)
		.where('rescheduled_to_id', 'is', null)
		.executeTakeFirst();
}

export async function expireStalePending(db: Kysely<Database>, nowIso: string): Promise<number> {
	const result = await db
		.updateTable('appointments')
		.set({ status: 'expired', updated_at: sql`CURRENT_TIMESTAMP` })
		.where('status', '=', 'pending')
		.where('start_time', '<=', nowIso)
		.executeTakeFirst();
	return Number(result.numUpdatedRows);
}
