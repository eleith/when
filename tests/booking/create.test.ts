import { describe, expect, test } from 'vitest';
import { createAppointment } from '../../src/lib/server/booking/create';
import { systemClock } from '../../src/lib/server/clock';
import { openDb } from '../../src/lib/server/db';
import { runMigrations } from '../../src/lib/server/db/migrate';
import { validConfig } from '../fixtures/valid-config';

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

const eventType = validConfig.event_types[0];

// destination_calendar points at a non-existent calendar id, so pushAppointment
// fails-soft (no network) and createAppointment records calendar_push = 'failed'.
const cfgPushFails = {
	...validConfig,
	event_types: [{ ...eventType, destination_calendar: 'no-such-calendar' }] as typeof validConfig.event_types
};
const pushFailType = cfgPushFails.event_types[0];

const input = {
	start: '2099-01-01T15:00:00Z',
	end: '2099-01-01T15:30:00Z',
	attendee: { name: 'Booker', email: 'booker@example.com', notes: null },
	location: null,
	baseUrl: 'https://when.example.com'
};

describe('createAppointment', () => {
	test('auto flow inserts a confirmed booking; calendar_push tracked when push fails', async () => {
		const db = await makeDb();
		try {
			const result = await createAppointment(
				{ db, cfg: cfgPushFails, clock: systemClock },
				{ ...input, eventType: pushFailType }
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
				const notif = JSON.parse(persisted.notification_status ?? '{}');
				expect(notif.calendar_push).toBe('failed');
			}
		} finally {
			await db.destroy();
		}
	});

	test('requires_confirmation flow inserts a pending booking', async () => {
		const db = await makeDb();
		try {
			const reqType = { ...pushFailType, booking_flow: 'requires_confirmation' as const };
			const result = await createAppointment(
				{
					db,
					cfg: { ...cfgPushFails, event_types: [reqType] as typeof validConfig.event_types },
					clock: systemClock
				},
				{ ...input, eventType: reqType }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.status).toBe('pending');
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
					notification_status: null
				})
				.execute();

			const result = await createAppointment(
				{ db, cfg: cfgPushFails, clock: systemClock },
				{ ...input, eventType: pushFailType }
			);
			expect(result).toEqual({ ok: false, reason: 'slot_taken' });
		} finally {
			await db.destroy();
		}
	});
});
