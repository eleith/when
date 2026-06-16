import { sql, type Kysely } from 'kysely';
import type { Appointment, Database } from './types.js';

/** Chain-root id: an appointment's own id unless it descends from a reschedule. */
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

/** The end of a reschedule chain: the row sharing `origin_id` that was never rescheduled further. */
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
