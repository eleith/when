import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createAppointment } from './create';
import { systemClock } from '$lib/server/clock';
import { openDb, runMigrations } from '@when/db';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('../workflow', () => ({ enqueueAppointmentEmail: vi.fn(), enqueueCalendarSync: vi.fn() }));
import { enqueueAppointmentEmail, enqueueCalendarSync } from '../workflow';

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

const eventType = validConfig.event_types[0];

const input = {
	start: '2099-01-01T15:00:00Z',
	end: '2099-01-01T15:30:00Z',
	attendee: {
		name: 'Booker',
		email: 'booker@example.com',
		answers: [],
		timezone: 'America/New_York'
	},
	location: null
};

describe('createAppointment', () => {
	beforeEach(() => {
		vi.mocked(enqueueAppointmentEmail).mockReset();
		vi.mocked(enqueueAppointmentEmail).mockImplementation((db, id) =>
			db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
		);
		vi.mocked(enqueueCalendarSync).mockReset();
	});

	test('auto flow inserts a confirmed appointment, queued for sync, and wakes the worker', async () => {
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
				expect(enqueueCalendarSync).toHaveBeenCalledTimes(1);
				expect(enqueueAppointmentEmail).toHaveBeenCalledTimes(1);
				expect(vi.mocked(enqueueAppointmentEmail).mock.calls[0][2]).toBe('confirmed');
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
				expect(enqueueAppointmentEmail).toHaveBeenCalledWith(
					expect.anything(),
					expect.any(String),
					'pending'
				);
				expect(enqueueCalendarSync).not.toHaveBeenCalled();
			}
		} finally {
			await db.destroy();
		}
	});

	test('requires_confirmation flow inserts a confirmed appointment if created by organizer', async () => {
		const db = await makeDb();
		try {
			const reqType = { ...eventType, appointment_flow: 'requires_confirmation' as const };
			const result = await createAppointment(
				{
					db,
					cfg: { ...validConfig, event_types: [reqType] as typeof validConfig.event_types },
					clock: systemClock
				},
				{ ...input, eventType: reqType, initiator: 'organizer' }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.status).toBe('confirmed');
				expect(enqueueAppointmentEmail).toHaveBeenCalledWith(
					expect.anything(),
					expect.any(String),
					'confirmed'
				);
				expect(enqueueCalendarSync).toHaveBeenCalled();
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
					attendee_name: 'Other',
					attendee_email: 'other@example.com',
					attendee_answers: null,
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
			expect(enqueueAppointmentEmail).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});
});
