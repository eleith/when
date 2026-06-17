import { sql, type Kysely, type SelectQueryBuilder } from 'kysely';
import type { Appointment, Database } from './types.js';

function originId(a: Pick<Appointment, 'id' | 'origin_id'>): string {
	return a.origin_id ?? a.id;
}

function findAppointment(db: Kysely<Database>, id: string): Promise<Appointment | undefined> {
	return db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirst();
}

function findChainTip(
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

async function expireStalePending(db: Kysely<Database>, nowIso: string): Promise<number> {
	const result = await db
		.updateTable('appointments')
		.set({ status: 'expired', updated_at: sql`CURRENT_TIMESTAMP` })
		.where('status', '=', 'pending')
		.where('start_time', '<=', nowIso)
		.executeTakeFirst();
	return Number(result.numUpdatedRows);
}

type AppointmentBucket = 'pending' | 'upcoming' | 'concluded' | 'archived';

function listAppointmentsPage(
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

function applyBucket<Selected>(
	qb: SelectQueryBuilder<Database, 'appointments', Selected>,
	bucket: AppointmentBucket,
	nowIso: string
) {
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

async function countAppointments(
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

export {
	originId,
	findAppointment,
	countAppointments,
	listAppointmentsPage,
	findChainTip,
	expireStalePending,
	type AppointmentBucket
};
