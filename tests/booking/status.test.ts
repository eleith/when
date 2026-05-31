import { describe, expect, test } from 'vitest';
import { transitionStatus } from '../../src/lib/server/booking/status';
import { systemClock } from '../../src/lib/server/clock';
import { openDb } from '../../src/lib/server/db';
import { runMigrations } from '../../src/lib/server/db/migrate';

const baseRow = {
	event_type_id: 'chat',
	start_time: '2026-05-01T10:00:00Z',
	end_time: '2026-05-01T10:30:00Z',
	attendee_name: 'A',
	attendee_email: 'a@example.com',
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

describe('transitionStatus', () => {
	test('happy path: returns ok with updated row', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a1', status: 'pending', cancel_token: 't1' })
				.execute();

			const result = await transitionStatus(
				{ db, clock: systemClock },
				{ id: 'a1', from: ['pending'], to: 'confirmed' }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.row.status).toBe('confirmed');
				expect(result.row.id).toBe('a1');
			}
		} finally {
			await db.destroy();
		}
	});

	test('not_found for unknown id', async () => {
		const db = await makeDb();
		try {
			const result = await transitionStatus(
				{ db, clock: systemClock },
				{ id: 'missing', from: ['pending'], to: 'confirmed' }
			);
			expect(result).toEqual({ ok: false, reason: 'not_found' });
		} finally {
			await db.destroy();
		}
	});

	test('conflict when current status is not in `from`', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a2', status: 'cancelled', cancel_token: 't2' })
				.execute();

			const result = await transitionStatus(
				{ db, clock: systemClock },
				{ id: 'a2', from: ['pending', 'confirmed'], to: 'cancelled' }
			);
			expect(result).toEqual({ ok: false, reason: 'conflict' });
		} finally {
			await db.destroy();
		}
	});

	test('two concurrent transitions: exactly one wins, other gets conflict', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'race', status: 'pending', cancel_token: 'tr' })
				.execute();

			const [r1, r2] = await Promise.all([
				transitionStatus(
					{ db, clock: systemClock },
					{ id: 'race', from: ['pending'], to: 'confirmed' }
				),
				transitionStatus(
					{ db, clock: systemClock },
					{ id: 'race', from: ['pending'], to: 'declined' }
				)
			]);

			const wins = [r1, r2].filter((r) => r.ok);
			const loses = [r1, r2].filter((r) => !r.ok);
			expect(wins).toHaveLength(1);
			expect(loses).toHaveLength(1);
			if (!loses[0]!.ok) {
				expect(loses[0]!.reason).toBe('conflict');
			}
		} finally {
			await db.destroy();
		}
	});

	test('patch is applied atomically with the status write', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a3', status: 'confirmed', cancel_token: 't3' })
				.execute();

			const result = await transitionStatus(
				{ db, clock: systemClock },
				{
					id: 'a3',
					from: ['confirmed'],
					to: 'cancelled',
					patch: { ics_sequence: 5 }
				}
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.row.status).toBe('cancelled');
				expect(result.row.ics_sequence).toBe(5);
			}
		} finally {
			await db.destroy();
		}
	});
});
