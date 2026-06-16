import { expect, test } from 'vitest';
import { openDb } from './index.js';
import { runMigrations } from './migrate.js';
import { expireStalePending, findAppointment, findCurrentInChain } from './appointments.js';
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
			attendee_notes: null,
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
				attendee_notes: null,
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

test('findCurrentInChain returns the one active occurrence of a chain', async () => {
	const db = await makeDb();
	try {
		// Chain rooted at 'A': A → B both rescheduled, C is the live tip; all share origin 'A'.
		await insert(db, 'A', 'rescheduled', '2099-01-01T15:00:00Z', 'A');
		await insert(db, 'B', 'rescheduled', '2099-01-02T15:00:00Z', 'A');
		await insert(db, 'C', 'confirmed', '2099-01-03T15:00:00Z', 'A');

		expect((await findCurrentInChain(db, 'A'))?.id).toBe('C');
	} finally {
		await db.destroy();
	}
});

test('findCurrentInChain is undefined when a chain has no live occurrence', async () => {
	const db = await makeDb();
	try {
		await insert(db, 'A', 'rescheduled', '2099-01-01T15:00:00Z', 'A');
		await insert(db, 'B', 'declined', '2099-01-02T15:00:00Z', 'A');

		expect(await findCurrentInChain(db, 'A')).toBeUndefined();
	} finally {
		await db.destroy();
	}
});
