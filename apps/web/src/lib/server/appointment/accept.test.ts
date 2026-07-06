import { beforeEach, describe, expect, test, vi } from 'vitest';
import { acceptAppointment } from './accept';
import { systemClock } from '$lib/server/clock';
import { openDb, runMigrations } from '@when/db';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('../workflow', () => ({ enqueueAppointmentReconciliation: vi.fn() }));
import { enqueueAppointmentReconciliation } from '../workflow';

const baseRow = {
	event_type_id: '30-min-chat',
	start_time: '2099-01-01T15:00:00Z',
	end_time: '2099-01-01T15:30:00Z',
	guest_name: 'Booker',
	guest_email: 'booker@example.com',
	guest_answers: null,
	location: null,
	external_event_id: null,
	external_calendar_id: null
};

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

async function fetchRow(db: Awaited<ReturnType<typeof makeDb>>, id: string) {
	return db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

describe('acceptAppointment', () => {
	beforeEach(() => {
		vi.mocked(enqueueAppointmentReconciliation).mockReset();
		vi.mocked(enqueueAppointmentReconciliation).mockImplementation(async (db, id) =>
			db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
		);
	});

	test('happy path: pending → confirmed; bumps revision, queues reconciliation', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a1', status: 'pending', cancel_token: 't1' })
				.execute();
			const row = await fetchRow(db, 'a1');

			const result = await acceptAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.status).toBe('confirmed');
				const persisted = await fetchRow(db, 'a1');
				expect(persisted.status).toBe('confirmed');
				expect(persisted.calendar_revision).toBe(1);
				expect(enqueueAppointmentReconciliation).toHaveBeenCalledWith(
					expect.anything(),
					expect.any(String),
					'confirmed'
				);
			}
		} finally {
			await db.destroy();
		}
	});

	test('gated: confirmed appointment cannot be accepted', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a2', status: 'confirmed', cancel_token: 't2' })
				.execute();
			const row = await fetchRow(db, 'a2');

			const result = await acceptAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row }
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
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row }
			);
			expect(result).toEqual({ ok: false, reason: 'conflict' });
		} finally {
			await db.destroy();
		}
	});
});
