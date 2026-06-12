import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createAppointment } from './create';
import { systemClock } from '$lib/server/clock';
import { openDb, runMigrations } from '@when/db';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('../workflow', () => ({ enqueueBookingEmail: vi.fn(), enqueueCalendarSync: vi.fn() }));
import { enqueueBookingEmail, enqueueCalendarSync } from '../workflow';

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

const eventType = validConfig.event_types[0];

const input = {
	start: '2099-01-01T15:00:00Z',
	end: '2099-01-01T15:30:00Z',
	attendee: { name: 'Booker', email: 'booker@example.com', notes: null },
	location: null
};

describe('createAppointment', () => {
	beforeEach(() => {
		vi.mocked(enqueueBookingEmail).mockReset();
		vi.mocked(enqueueBookingEmail).mockImplementation((db, id) =>
			db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
		);
		vi.mocked(enqueueCalendarSync).mockReset();
	});

	test('auto flow inserts a confirmed booking, queued for sync, and wakes the worker', async () => {
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
				expect(persisted.calendar_push_notification_status).toBe('queued');
				expect(enqueueCalendarSync).toHaveBeenCalledTimes(1);
				expect(enqueueBookingEmail).toHaveBeenCalledTimes(1);
				expect(vi.mocked(enqueueBookingEmail).mock.calls[0][2]).toBe('confirmed');
			}
		} finally {
			await db.destroy();
		}
	});

	test('requires_confirmation flow inserts a pending booking', async () => {
		const db = await makeDb();
		try {
			const reqType = { ...eventType, booking_flow: 'requires_confirmation' as const };
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
				expect(enqueueBookingEmail).toHaveBeenCalledWith(
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

	test('slot_taken: an active booking at the same slot blocks the insert', async () => {
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
					attendee_notes: null,
					location: null,
					status: 'confirmed',
					cancel_token: 'tok-existing',
					external_event_id: null,
					external_calendar_id: null,
					email_notification_status: null,
					calendar_push_notification_status: null
				})
				.execute();

			const result = await createAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ ...input, eventType }
			);
			expect(result).toEqual({ ok: false, reason: 'slot_taken' });
			expect(enqueueBookingEmail).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});
});
