import { describe, expect, test } from 'vitest';
import { acceptAppointment } from '$lib/server/booking/accept';
import { systemClock } from '$lib/server/clock';
import { openDb } from '$lib/server/db';
import { runMigrations } from '$lib/server/db/migrate';
import { validConfig } from '../fixtures/valid-config';

const baseRow = {
	event_type_id: '30-min-chat',
	start_time: '2099-01-01T15:00:00Z',
	end_time: '2099-01-01T15:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_notes: null,
	location: null,
	external_event_id: null,
	external_calendar_id: null,
	notification_status: null
};

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

async function fetchRow(db: Awaited<ReturnType<typeof makeDb>>, id: string) {
	return db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

// Use a config whose destination_calendar refers to a non-existent calendar id, so
// pushAppointment fails-soft with { ok: false } and the operation marks
// notification_status.calendar_push = 'failed'. This avoids real network calls.
const cfgPushFails = {
	...validConfig,
	event_types: [
		{ ...validConfig.event_types[0], destination_calendar: 'no-such-calendar' }
	] as typeof validConfig.event_types
};

describe('acceptAppointment', () => {
	test('happy path: pending → confirmed; calendar_push tracked when push fails', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a1', status: 'pending', cancel_token: 't1' })
				.execute();
			const row = await fetchRow(db, 'a1');

			const result = await acceptAppointment(
				{ db, cfg: cfgPushFails, clock: systemClock },
				{ appointment: row, baseUrl: 'https://when.example.com' }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.status).toBe('confirmed');
				const persisted = await fetchRow(db, 'a1');
				expect(persisted.status).toBe('confirmed');
				// Push failed → notification_status records it.
				const notif = JSON.parse(persisted.notification_status ?? '{}');
				expect(notif.calendar_push).toBe('failed');
			}
		} finally {
			await db.destroy();
		}
	});

	test('gated: confirmed booking cannot be accepted', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a2', status: 'confirmed', cancel_token: 't2' })
				.execute();
			const row = await fetchRow(db, 'a2');

			const result = await acceptAppointment(
				{ db, cfg: cfgPushFails, clock: systemClock },
				{ appointment: row, baseUrl: 'https://when.example.com' }
			);
			expect(result).toEqual({ ok: false, reason: 'gated' });
		} finally {
			await db.destroy();
		}
	});

	test('conflict: row already declined by concurrent caller', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a3', status: 'pending', cancel_token: 't3' })
				.execute();
			const row = await fetchRow(db, 'a3');
			await db
				.updateTable('appointments')
				.set({ status: 'declined' })
				.where('id', '=', 'a3')
				.execute();

			const result = await acceptAppointment(
				{ db, cfg: cfgPushFails, clock: systemClock },
				{ appointment: row, baseUrl: 'https://when.example.com' }
			);
			expect(result).toEqual({ ok: false, reason: 'conflict' });
		} finally {
			await db.destroy();
		}
	});
});
