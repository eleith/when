import { expect, test } from 'vitest';
import { openDb } from './index.js';
import { runMigrations } from './migrate.js';
import {
	expireStalePending,
	findAppointment,
	findChainTip,
	listAppointmentsPage,
	countAppointments,
	isChainTerminal,
	deleteChain,
	appendJobLogSql,
	parseActionLog
} from './appointments.js';
import type { AppointmentStatus } from './types.js';

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

async function insert(
	db: Awaited<ReturnType<typeof makeDb>>,
	id: string,
	status: AppointmentStatus,
	startTime: string,
	origin = id
) {
	await db
		.insertInto('appointments')
		.values({
			id,
			event_type_id: 'chat',
			start_time: startTime,
			end_time: startTime,
			attendee_name: 'Booker',
			attendee_email: 'booker@example.com',
			location: null,
			status,
			origin_id: origin,
			cancel_token: `tok-${id}`,
			external_event_id: null,
			external_calendar_id: null,
			email_notification_status: null,
			calendar_push_notification_status: null
		})
		.execute();
}

test('findAppointment returns the row by id, or undefined when missing', async () => {
	const db = await makeDb();
	try {
		await db
			.insertInto('appointments')
			.values({
				id: 'a1',
				event_type_id: 'chat',
				start_time: '2099-01-01T15:00:00Z',
				end_time: '2099-01-01T15:30:00Z',
				attendee_name: 'Booker',
				attendee_email: 'booker@example.com',
				location: null,
				status: 'confirmed',
				cancel_token: 't1',
				external_event_id: null,
				external_calendar_id: null,
				email_notification_status: null,
				calendar_push_notification_status: null
			})
			.execute();

		const found = await findAppointment(db, 'a1');
		expect(found?.id).toBe('a1');
		expect(found?.status).toBe('confirmed');

		expect(await findAppointment(db, 'ghost')).toBeUndefined();
	} finally {
		await db.destroy();
	}
});

test('appendJobLogSql appends system email/calendar entries, leaving prior entries intact', async () => {
	const db = await makeDb();
	try {
		await insert(db, 'a1', 'confirmed', '2099-01-01T15:00:00Z');

		await db
			.updateTable('appointments')
			.set({
				action_log: appendJobLogSql({
					kind: 'email',
					at: '2026-06-21T10:00:00Z',
					state: 'queued',
					appointment_id: 'a1'
				})
			})
			.where('id', '=', 'a1')
			.execute();
		await db
			.updateTable('appointments')
			.set({
				action_log: appendJobLogSql({
					kind: 'calendar',
					at: '2026-06-21T10:01:00Z',
					state: 'done',
					appointment_id: 'a1',
					op: 'create'
				})
			})
			.where('id', '=', 'a1')
			.execute();

		const row = await findAppointment(db, 'a1');
		expect(parseActionLog(row?.action_log ?? null)).toEqual([
			{
				action: 'email',
				actor: 'system',
				at: '2026-06-21T10:00:00Z',
				payload: { metadata: { state: 'queued', appointment_id: 'a1' } }
			},
			{
				action: 'calendar',
				actor: 'system',
				at: '2026-06-21T10:01:00Z',
				payload: { metadata: { state: 'done', appointment_id: 'a1', op: 'create' } }
			}
		]);
	} finally {
		await db.destroy();
	}
});

test('expireStalePending retires only pending rows whose start has passed', async () => {
	const db = await makeDb();
	try {
		const now = '2026-06-14T12:00:00Z';
		await insert(db, 'past-pending', 'pending', '2026-06-14T11:00:00Z');
		await insert(db, 'future-pending', 'pending', '2026-06-14T13:00:00Z');
		await insert(db, 'past-confirmed', 'confirmed', '2026-06-14T10:00:00Z');

		const count = await expireStalePending(db, now);

		expect(count).toBe(1);
		expect((await findAppointment(db, 'past-pending'))?.status).toBe('expired');
		expect((await findAppointment(db, 'future-pending'))?.status).toBe('pending');
		expect((await findAppointment(db, 'past-confirmed'))?.status).toBe('confirmed');

		// Idempotent: a second sweep finds nothing left to retire.
		expect(await expireStalePending(db, now)).toBe(0);
	} finally {
		await db.destroy();
	}
});

test('findChainTip returns the end of the chain (the row never rescheduled further)', async () => {
	const db = await makeDb();
	try {
		await insert(db, 'A', 'rescheduled', '2099-01-01T15:00:00Z', 'A');
		await insert(db, 'B', 'rescheduled', '2099-01-02T15:00:00Z', 'A');
		await insert(db, 'C', 'confirmed', '2099-01-03T15:00:00Z', 'A');

		expect((await findChainTip(db, 'A'))?.id).toBe('C');
	} finally {
		await db.destroy();
	}
});

test('findChainTip returns the terminal tip when a chain ends cancelled', async () => {
	const db = await makeDb();
	try {
		await insert(db, 'A', 'rescheduled', '2099-01-01T15:00:00Z', 'A');
		await insert(db, 'B', 'cancelled', '2099-01-02T15:00:00Z', 'A');

		expect((await findChainTip(db, 'A'))?.id).toBe('B');
	} finally {
		await db.destroy();
	}
});

test('bucket listings and counts', async () => {
	const db = await makeDb();
	try {
		const now = new Date('2026-06-15T12:00:00Z');

		const insertWithEnd = async (
			id: string,
			status: AppointmentStatus,
			startTime: string,
			endTime: string,
			origin = id
		) => {
			await db
				.insertInto('appointments')
				.values({
					id,
					event_type_id: 'chat',
					start_time: startTime,
					end_time: endTime,
					attendee_name: 'Booker',
					attendee_email: 'booker@example.com',
					location: null,
					status,
					origin_id: origin,
					cancel_token: `tok-${id}`,
					external_event_id: null,
					external_calendar_id: null,
					email_notification_status: null,
					calendar_push_notification_status: null
				})
				.execute();
		};

		// pending: status='pending'
		await insertWithEnd('pending1', 'pending', '2026-06-15T14:00:00Z', '2026-06-15T14:30:00Z');
		await insertWithEnd('pending2', 'pending', '2026-06-15T10:00:00Z', '2026-06-15T10:30:00Z');

		// upcoming: status='confirmed', end_time > now
		await insertWithEnd('upcoming1', 'confirmed', '2026-06-15T13:00:00Z', '2026-06-15T13:30:00Z');
		await insertWithEnd(
			'upcoming-inprogress',
			'confirmed',
			'2026-06-15T11:30:00Z',
			'2026-06-15T12:30:00Z'
		);

		// concluded: status='confirmed', end_time <= now
		await insertWithEnd('concluded1', 'confirmed', '2026-06-15T11:00:00Z', '2026-06-15T11:30:00Z');
		await insertWithEnd('concluded2', 'confirmed', '2026-06-15T09:00:00Z', '2026-06-15T09:30:00Z');

		// archived: status in ('declined', 'cancelled', 'expired')
		await insertWithEnd('declined1', 'declined', '2026-06-15T15:00:00Z', '2026-06-15T15:30:00Z');
		await insertWithEnd('cancelled1', 'cancelled', '2026-06-15T16:00:00Z', '2026-06-15T16:30:00Z');
		await insertWithEnd('expired1', 'expired', '2026-06-15T08:00:00Z', '2026-06-15T08:30:00Z');

		// rescheduled and purged: should be excluded everywhere
		await insertWithEnd(
			'rescheduled1',
			'rescheduled',
			'2026-06-15T13:00:00Z',
			'2026-06-15T13:30:00Z'
		);
		await insertWithEnd('purged1', 'purged', '2026-06-15T16:00:00Z', '2026-06-15T16:30:00Z');

		// --- Test Pending ---
		expect(await countAppointments(db, { bucket: 'pending', now })).toBe(2);
		const pendingList = await listAppointmentsPage(db, {
			bucket: 'pending',
			now,
			limit: 10,
			offset: 0
		});
		expect(pendingList.map((a) => a.id)).toEqual(['pending2', 'pending1']);

		// --- Test Upcoming ---
		expect(await countAppointments(db, { bucket: 'upcoming', now })).toBe(2);
		const upcomingList = await listAppointmentsPage(db, {
			bucket: 'upcoming',
			now,
			limit: 10,
			offset: 0
		});
		expect(upcomingList.map((a) => a.id)).toEqual(['upcoming-inprogress', 'upcoming1']);

		// --- Test Concluded ---
		expect(await countAppointments(db, { bucket: 'concluded', now })).toBe(2);
		const concludedList = await listAppointmentsPage(db, {
			bucket: 'concluded',
			now,
			limit: 10,
			offset: 0
		});
		expect(concludedList.map((a) => a.id)).toEqual(['concluded1', 'concluded2']);

		// --- Test Archived ---
		expect(await countAppointments(db, { bucket: 'archived', now })).toBe(3);
		const archivedList = await listAppointmentsPage(db, {
			bucket: 'archived',
			now,
			limit: 10,
			offset: 0
		});
		expect(archivedList.map((a) => a.id)).toEqual(['cancelled1', 'declined1', 'expired1']);
	} finally {
		await db.destroy();
	}
});

test('isChainTerminal validation rules', async () => {
	const db = await makeDb();
	try {
		const now = new Date('2026-06-15T12:00:00Z');

		// 1. Not found
		expect(await isChainTerminal(db, 'missing', now)).toEqual({
			terminal: false,
			reason: 'not_found'
		});

		// 2. Confirmed upcoming -> blocked
		await insert(db, 'upcoming', 'confirmed', '2026-06-15T13:00:00Z');
		expect(await isChainTerminal(db, 'upcoming', now)).toEqual({
			terminal: false,
			reason: 'not_terminal'
		});

		// 3. Confirmed concluded -> allowed
		await insert(db, 'concluded', 'confirmed', '2026-06-15T11:00:00Z');
		expect(await isChainTerminal(db, 'concluded', now)).toEqual({
			terminal: true
		});

		// 4. Cancelled -> allowed
		await insert(db, 'cancelled', 'cancelled', '2026-06-15T13:00:00Z');
		expect(await isChainTerminal(db, 'cancelled', now)).toEqual({
			terminal: true
		});

		// 5. Notifications queued -> blocked
		await insert(db, 'queued', 'cancelled', '2026-06-15T13:00:00Z');
		await db
			.updateTable('appointments')
			.set({ email_notification_status: 'queued' })
			.where('id', '=', 'queued')
			.execute();
		expect(await isChainTerminal(db, 'queued', now)).toEqual({
			terminal: false,
			reason: 'notifications_queued'
		});
	} finally {
		await db.destroy();
	}
});

test('deleteChain purges the entire reschedule chain', async () => {
	const db = await makeDb();
	try {
		// Chain A -> B -> C
		await insert(db, 'A', 'rescheduled', '2026-06-15T10:00:00Z', 'A');
		await insert(db, 'B', 'rescheduled', '2026-06-15T11:00:00Z', 'A');
		await insert(db, 'C', 'cancelled', '2026-06-15T12:00:00Z', 'A');

		// Standalone D
		await insert(db, 'D', 'cancelled', '2026-06-15T12:00:00Z', 'D');

		const deleted = await deleteChain(db, 'A');
		expect(deleted).toBe(3); // A, B, C deleted

		expect(await findAppointment(db, 'A')).toBeUndefined();
		expect(await findAppointment(db, 'B')).toBeUndefined();
		expect(await findAppointment(db, 'C')).toBeUndefined();
		expect(await findAppointment(db, 'D')).toBeDefined(); // D remains untouched
	} finally {
		await db.destroy();
	}
});
