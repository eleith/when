import { describe, expect, test } from 'vitest';
import { declineAppointment } from '$lib/server/booking/decline';
import { systemClock } from '$lib/server/clock';
import { openDb } from '$lib/server/db';
import { runMigrations } from '$lib/server/db/migrate';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

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

describe('declineAppointment', () => {
	test('happy path: pending → declined', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'd1', status: 'pending', cancel_token: 't1' })
				.execute();
			const row = await fetchRow(db, 'd1');

			const result = await declineAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.status).toBe('declined');
				const persisted = await fetchRow(db, 'd1');
				expect(persisted.status).toBe('declined');
			}
		} finally {
			await db.destroy();
		}
	});

	test('gated: confirmed booking cannot be declined', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'd2', status: 'confirmed', cancel_token: 't2' })
				.execute();
			const row = await fetchRow(db, 'd2');

			const result = await declineAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row }
			);
			expect(result).toEqual({ ok: false, reason: 'gated' });
		} finally {
			await db.destroy();
		}
	});

	test('conflict: row already accepted by concurrent caller', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'd3', status: 'pending', cancel_token: 't3' })
				.execute();
			const row = await fetchRow(db, 'd3');
			await db
				.updateTable('appointments')
				.set({ status: 'confirmed' })
				.where('id', '=', 'd3')
				.execute();

			const result = await declineAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row }
			);
			expect(result).toEqual({ ok: false, reason: 'conflict' });
		} finally {
			await db.destroy();
		}
	});
});
