import { sql, type Kysely } from 'kysely';
import type { Appointment, Database } from './types.js';

/** Fetch a single appointment by id (the full row), or undefined if none. */
export function findAppointment(
	db: Kysely<Database>,
	id: string
): Promise<Appointment | undefined> {
	return db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirst();
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
