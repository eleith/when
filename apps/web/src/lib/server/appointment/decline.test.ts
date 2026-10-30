import { beforeEach, describe, expect, test, vi } from 'vitest';
import { declineAppointment } from './decline';
import { confirmAppointment } from './transitions';
import { systemClock } from '#lib/server/clock.js';
import { openDb, runMigrations } from '@when/db';
import { validConfig } from '#lib/server/__fixtures__/valid-config.js';

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

const decisionTime = '2026-01-01T12:00:00.000Z';
const fixedClock = {
	now: () => new Date(decisionTime),
	nowMs: () => Date.parse(decisionTime)
};

describe('declineAppointment with a note', () => {
	beforeEach(() => {
		vi.mocked(enqueueAppointmentReconciliation).mockReset();
		vi.mocked(enqueueAppointmentReconciliation).mockResolvedValue(undefined);
	});

	test('persists the decline note separately and reconciles the unchanged inherited event pointer', async () => {
		const db = await makeDb();
		try {
			const previous = { action: 'confirm', actor: 'host', at: '2025-12-01T12:00:00Z' };
			await db
				.insertInto('appointments')
				.values({
					...baseRow,
					id: 'noted',
					status: 'pending',
					cancel_token: 'original-token',
					origin_id: 'original-id',
					note: 'Private preparation note',
					external_event_id: 'inherited-event',
					external_calendar_id: 'work',
					calendar_revision: 7,
					calendar_synced_revision: 7,
					ics_sequence: 3,
					action_log: JSON.stringify([previous])
				})
				.execute();
			const row = await fetchRow(db, 'noted');
			const note = 'Sorry, I cannot make this.\nPlease try Friday — ありがとう.';

			const result = await declineAppointment(
				{ db, cfg: validConfig, clock: fixedClock },
				{ appointment: row, note }
			);

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const persisted = await fetchRow(db, 'noted');
			expect(result.appointment).toEqual(persisted);
			expect(persisted).toMatchObject({
				id: row.id,
				origin_id: row.origin_id,
				cancel_token: row.cancel_token,
				start_time: row.start_time,
				end_time: row.end_time,
				status: 'declined',
				note: 'Private preparation note',
				external_event_id: 'inherited-event',
				external_calendar_id: 'work',
				calendar_revision: 8,
				calendar_synced_revision: 7,
				ics_sequence: 4
			});
			expect(JSON.parse(persisted.action_log!)).toEqual([
				previous,
				{ action: 'decline', actor: 'host', at: decisionTime, payload: { note } }
			]);
			expect(enqueueAppointmentReconciliation).toHaveBeenCalledExactlyOnceWith(
				persisted,
				'declined'
			);
		} finally {
			await db.destroy();
		}
	});

	test.each(['confirmed', 'declined', 'cancelled', 'rescheduled', 'purged', 'past'] as const)(
		'does not save a note or reconcile a gated %s appointment',
		async (state) => {
			const db = await makeDb();
			try {
				await db
					.insertInto('appointments')
					.values({
						...baseRow,
						id: 'gated-note',
						status: state === 'past' ? 'pending' : state,
						start_time: state === 'past' ? '2025-01-01T15:00:00Z' : baseRow.start_time,
						cancel_token: 'gated-token',
						note: 'Keep this private'
					})
					.execute();
				const before = await fetchRow(db, 'gated-note');

				const result = await declineAppointment(
					{ db, cfg: validConfig, clock: fixedClock },
					{ appointment: before, note: 'Must not be saved' }
				);

				const after = await fetchRow(db, 'gated-note');
				expect(result).toEqual({ ok: false, reason: 'gated' });
				expect(after).toEqual(before);
				expect(enqueueAppointmentReconciliation).not.toHaveBeenCalled();
			} finally {
				await db.destroy();
			}
		}
	);

	test('a concurrent acceptance wins without a partial decline note, log, or counter update', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					...baseRow,
					id: 'accepted-first',
					status: 'pending',
					cancel_token: 'race-token',
					note: 'Original preparation'
				})
				.execute();
			const stale = await fetchRow(db, 'accepted-first');
			const accepted = await confirmAppointment(db, stale.id, decisionTime);
			const beforeDecline = await fetchRow(db, stale.id);

			const result = await declineAppointment(
				{ db, cfg: validConfig, clock: fixedClock },
				{ appointment: stale, note: 'Losing decline note' }
			);

			const after = await fetchRow(db, stale.id);
			expect(accepted).toEqual({ ok: true });
			expect(result).toEqual({ ok: false, reason: 'conflict' });
			expect(after).toEqual(beforeDecline);
			expect(after.status).toBe('confirmed');
			expect(after.note).toBe('Original preparation');
			expect(after.calendar_revision).toBe(1);
			expect(after.ics_sequence).toBe(0);
			expect(JSON.parse(after.action_log!)).toEqual([
				{ action: 'confirm', actor: 'host', at: decisionTime }
			]);
			expect(enqueueAppointmentReconciliation).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});
});

describe('declineAppointment', () => {
	beforeEach(() => {
		vi.mocked(enqueueAppointmentReconciliation).mockReset();
		vi.mocked(enqueueAppointmentReconciliation).mockResolvedValue(undefined);
	});

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
				expect(enqueueAppointmentReconciliation).toHaveBeenCalledWith(
					result.appointment,
					'declined'
				);
			}
		} finally {
			await db.destroy();
		}
	});

	test('gated: confirmed appointment cannot be declined', async () => {
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
