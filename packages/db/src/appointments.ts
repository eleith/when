import { sql, type Kysely, type SelectQueryBuilder, type RawBuilder } from 'kysely';
import type { Appointment, Database, ActionLogEntry } from './types.js';

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
		.set({
			status: 'expired',
			action_log: appendActionLogSql({ action: 'expire', actor: 'system', at: nowIso }),
			updated_at: sql`CURRENT_TIMESTAMP`
		})
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

async function isChainTerminal(
	db: Kysely<Database>,
	id: string,
	now: Date
): Promise<{ terminal: boolean; reason?: 'not_found' | 'not_terminal' | 'notifications_queued' }> {
	const row = await findAppointment(db, id);
	if (!row) return { terminal: false, reason: 'not_found' };

	const chainOriginId = originId(row);

	// 1. Check if any notification in the chain is still queued
	const queuedResult = await db
		.selectFrom('appointments')
		.select((eb) => eb.fn.countAll().as('count'))
		.where((eb) => eb('origin_id', '=', chainOriginId).or('id', '=', chainOriginId))
		.where((eb) =>
			eb('email_notification_status', '=', 'queued').or(
				'calendar_push_notification_status',
				'=',
				'queued'
			)
		)
		.executeTakeFirst();

	if (queuedResult && Number(queuedResult.count) > 0) {
		return { terminal: false, reason: 'notifications_queued' };
	}

	// 2. Find the chain tip and verify status is terminal or concluded
	const tip = await findChainTip(db, chainOriginId);
	if (!tip) return { terminal: false, reason: 'not_terminal' };

	const isTerminal = ['cancelled', 'declined', 'expired'].includes(tip.status);
	const isConcluded = tip.status === 'confirmed' && Date.parse(tip.end_time) <= now.getTime();

	if (!isTerminal && !isConcluded) {
		return { terminal: false, reason: 'not_terminal' };
	}

	return { terminal: true };
}

async function deleteChain(db: Kysely<Database>, chainOriginId: string): Promise<number> {
	const result = await db
		.deleteFrom('appointments')
		.where((eb) => eb('origin_id', '=', chainOriginId).or('id', '=', chainOriginId))
		.executeTakeFirst();
	return Number(result.numDeletedRows);
}

function parseActionLog(raw: string | null): ActionLogEntry[] {
	if (!raw) return [];
	try {
		return JSON.parse(raw);
	} catch {
		return [];
	}
}

function appendActionLogSql(
	entry: Omit<ActionLogEntry, 'at'> & { at: string }
): RawBuilder<string> {
	const payloadJson = entry.payload ? JSON.stringify(entry.payload) : null;
	if (payloadJson) {
		return sql`json_insert(coalesce(action_log, '[]'), '$[#]', json(json_object('action', ${entry.action}, 'actor', ${entry.actor}, 'at', ${entry.at}, 'payload', json(${payloadJson}))))`;
	}
	return sql`json_insert(coalesce(action_log, '[]'), '$[#]', json(json_object('action', ${entry.action}, 'actor', ${entry.actor}, 'at', ${entry.at})))`;
}

function createActionLog(
	entries: [ActionLogEntry, ...ActionLogEntry[]]
): string {
	return JSON.stringify(entries);
}

export {
	originId,
	findAppointment,
	countAppointments,
	listAppointmentsPage,
	findChainTip,
	expireStalePending,
	isChainTerminal,
	deleteChain,
	parseActionLog,
	appendActionLogSql,
	createActionLog,
	type AppointmentBucket
};
