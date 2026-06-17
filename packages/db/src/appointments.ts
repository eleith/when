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

export type AppointmentBucket = 'pending' | 'upcoming' | 'concluded' | 'archived';

function applyBucket(qb: any, bucket: AppointmentBucket, nowIso: string): any {
	switch (bucket) {
		case 'pending':
			return qb.where('status', '=', 'pending');
		case 'upcoming':
			return qb.where('status', '=', 'confirmed').where('end_time', '>', nowIso);
		case 'concluded':
			return qb.where('status', '=', 'confirmed').where('end_time', '<=', nowIso);
		case 'archived':
			return qb.where('status', 'in', ['declined', 'cancelled', 'expired']);
	}
}

export function listAppointmentsPage(
	db: Kysely<Database>,
	opts: {
		bucket: AppointmentBucket;
		now: Date;
		limit: number;
		offset: number;
	}
): Promise<Appointment[]> {
	const nowIso = opts.now.toISOString();
	let qb = db.selectFrom('appointments').selectAll();
	qb = applyBucket(qb, opts.bucket, nowIso);

	if (opts.bucket === 'pending' || opts.bucket === 'upcoming') {
		qb = qb.orderBy('start_time', 'asc');
	} else {
		qb = qb.orderBy('start_time', 'desc');
	}

	return qb.limit(opts.limit).offset(opts.offset).execute();
}

export async function countAppointments(
	db: Kysely<Database>,
	opts: {
		bucket: AppointmentBucket;
		now: Date;
	}
): Promise<number> {
	const nowIso = opts.now.toISOString();
	let qb = db.selectFrom('appointments');
	qb = applyBucket(qb, opts.bucket, nowIso);
	const res = await qb.select(sql<number>`count(*)`.as('cnt')).executeTakeFirst();
	return Number(res?.cnt ?? 0);
}

