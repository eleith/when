import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createAppointment } from './create';
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

const eventType = validConfig.event_types[0];

const input = {
	start: '2099-01-01T15:00:00Z',
	end: '2099-01-01T15:30:00Z',
	guest: {
		name: 'Booker',
		email: 'booker@example.com',
		answers: [],
		timezone: 'America/New_York'
	},
	location: null
};

describe('createAppointment', () => {
	beforeEach(() => {
		vi.mocked(enqueueAppointmentReconciliation).mockReset();
		vi.mocked(enqueueAppointmentReconciliation).mockImplementation(async (db, id) =>
			db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
		);
	});

	test('auto flow inserts a confirmed appointment, queued for reconciliation', async () => {
		const db = await makeDb();
		try {
			const result = await createAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ ...input, eventType }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.status).toBe('confirmed');
				const persisted = await db
					.selectFrom('appointments')
					.selectAll()
					.where('id', '=', result.appointment.id)
					.executeTakeFirstOrThrow();
				expect(persisted.status).toBe('confirmed');
				expect(enqueueAppointmentReconciliation).toHaveBeenCalledTimes(1);
				expect(vi.mocked(enqueueAppointmentReconciliation).mock.calls[0][2]).toBe('confirmed');
			}
		} finally {
			await db.destroy();
		}
	});

	test('requires_confirmation flow inserts a pending appointment', async () => {
		const db = await makeDb();
		try {
			const reqType = { ...eventType, appointment_flow: 'requires_confirmation' as const };
			const result = await createAppointment(
				{
					db,
					cfg: { ...validConfig, event_types: [reqType] as typeof validConfig.event_types },
					clock: systemClock
				},
				{ ...input, eventType: reqType }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.status).toBe('pending');
				expect(enqueueAppointmentReconciliation).toHaveBeenCalledWith(
					expect.anything(),
					expect.any(String),
					'pending'
				);
			}
		} finally {
			await db.destroy();
		}
	});

	test('requires_confirmation flow inserts a confirmed appointment if created by host', async () => {
		const db = await makeDb();
		try {
			const reqType = { ...eventType, appointment_flow: 'requires_confirmation' as const };
			const result = await createAppointment(
				{
					db,
					cfg: { ...validConfig, event_types: [reqType] as typeof validConfig.event_types },
					clock: systemClock
				},
				{ ...input, eventType: reqType, initiator: 'host' }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.status).toBe('confirmed');
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

	test('slot_taken: an active appointment at the same slot blocks the insert', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					id: 'existing',
					event_type_id: eventType.id,
					start_time: input.start,
					end_time: input.end,
					guest_name: 'Other',
					guest_email: 'other@example.com',
					guest_answers: null,
					location: null,
					status: 'confirmed',
					cancel_token: 'tok-existing',
					external_event_id: null,
					external_calendar_id: null
				})
				.execute();

			const result = await createAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ ...input, eventType }
			);
			expect(result).toEqual({ ok: false, reason: 'slot_taken' });
			expect(enqueueAppointmentReconciliation).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});
});
