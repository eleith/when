import { beforeEach, describe, expect, test, vi } from 'vitest';
import { cancelAppointment } from './cancel';
import { systemClock } from '$lib/server/clock';
import { openDb, runMigrations, type ActionLogEntry } from '@when/db';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('../workflow', () => ({ enqueueAppointmentEmail: vi.fn(), enqueueCalendarSync: vi.fn() }));
import { enqueueAppointmentEmail, enqueueCalendarSync } from '../workflow';

const baseRow = {
	event_type_id: '30-min-chat',
	start_time: '2099-01-01T15:00:00Z', // far future so the cancel gate is allowed
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

async function insert(db: Awaited<ReturnType<typeof makeDb>>, overrides: Record<string, unknown>) {
	await db
		.insertInto('appointments')
		.values({ ...baseRow, ...overrides } as never)
		.execute();
}

async function fetchRow(db: Awaited<ReturnType<typeof makeDb>>, id: string) {
	return db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

describe('cancelAppointment', () => {
	beforeEach(() => {
		vi.mocked(enqueueAppointmentEmail).mockReset();
		vi.mocked(enqueueAppointmentEmail).mockImplementation((db, id) =>
			db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
		);
		vi.mocked(enqueueCalendarSync).mockReset();
	});

	test('happy path: a published appointment is cancelled, queued for deletion, and wakes the worker', async () => {
		const db = await makeDb();
		try {
			await insert(db, {
				id: 'a1',
				status: 'confirmed',
				cancel_token: 't1',
				external_event_id: 'ext-1',
				external_calendar_id: 'my-google-cal'
			});
			const row = await fetchRow(db, 'a1');

			const result = await cancelAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row, initiator: 'guest' }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.status).toBe('cancelled');
				expect(result.appointment.ics_sequence).toBe(1);
			}

			const persisted = await fetchRow(db, 'a1');
			expect(persisted.status).toBe('cancelled');
			expect(persisted.ics_sequence).toBe(1);
			expect(persisted.calendar_revision).toBe(1);
			expect(enqueueCalendarSync).toHaveBeenCalledTimes(1);
			expect(enqueueAppointmentEmail).toHaveBeenCalledWith(
				expect.anything(),
				expect.any(String),
				'cancelled-by-guest'
			);
		} finally {
			await db.destroy();
		}
	});

	test('gated: declined appointment returns { ok: false, reason: gated }, no DB change', async () => {
		const db = await makeDb();
		try {
			await insert(db, { id: 'a2', status: 'declined', cancel_token: 't2' });
			const row = await fetchRow(db, 'a2');

			const result = await cancelAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row, initiator: 'guest' }
			);

			expect(result).toEqual({ ok: false, reason: 'gated' });
			const persisted = await fetchRow(db, 'a2');
			expect(persisted.status).toBe('declined');
			expect(persisted.ics_sequence).toBe(0);
		} finally {
			await db.destroy();
		}
	});

	test('conflict: row already cancelled by a concurrent caller returns { ok: false, reason: conflict }', async () => {
		const db = await makeDb();
		try {
			await insert(db, { id: 'a3', status: 'confirmed', cancel_token: 't3' });
			const row = await fetchRow(db, 'a3');

			// Simulate a concurrent cancel landing first.
			await db
				.updateTable('appointments')
				.set({ status: 'cancelled' })
				.where('id', '=', 'a3')
				.execute();

			// The original caller still has the pre-conflict row in hand.
			// Gate would say "ok" because we haven't refetched, but transitionStatus
			// owns the CAS and reports the conflict.
			const result = await cancelAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row, initiator: 'guest' }
			);

			expect(result).toEqual({ ok: false, reason: 'conflict' });
		} finally {
			await db.destroy();
		}
	});

	test('reason is persisted on the row when provided', async () => {
		const db = await makeDb();
		try {
			await insert(db, { id: 'a4', status: 'confirmed', cancel_token: 't4' });
			const row = await fetchRow(db, 'a4');

			const result = await cancelAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row, initiator: 'guest', reason: 'I found a conflict' }
			);

			expect(result.ok).toBe(true);
			const persisted = await fetchRow(db, 'a4');
			const log = JSON.parse(persisted.action_log!);
			expect(log.find((e: ActionLogEntry) => e.action === 'cancel')?.payload?.note).toBe(
				'I found a conflict'
			);
		} finally {
			await db.destroy();
		}
	});

	test('cancel_reason is null when no reason is passed', async () => {
		const db = await makeDb();
		try {
			await insert(db, { id: 'a5', status: 'confirmed', cancel_token: 't5' });
			const row = await fetchRow(db, 'a5');

			const result = await cancelAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row, initiator: 'host' }
			);

			expect(result.ok).toBe(true);
			const persisted = await fetchRow(db, 'a5');
			const log = JSON.parse(persisted.action_log!);
			expect(log.find((e: ActionLogEntry) => e.action === 'cancel')?.payload?.note).toBeUndefined();
		} finally {
			await db.destroy();
		}
	});

	test('gated cancel does not write reason to the row', async () => {
		const db = await makeDb();
		try {
			await insert(db, { id: 'a6', status: 'declined', cancel_token: 't6' });
			const row = await fetchRow(db, 'a6');

			await cancelAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointment: row, initiator: 'guest', reason: 'Not interested' }
			);

			const persisted = await fetchRow(db, 'a6');
			expect(persisted.status).toBe('declined');
			expect(persisted.action_log).toBeNull();
		} finally {
			await db.destroy();
		}
	});
});
