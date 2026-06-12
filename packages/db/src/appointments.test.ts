import { expect, test } from 'vitest';
import { openDb } from './index.js';
import { runMigrations } from './migrate.js';
import { findAppointment } from './appointments.js';

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

test('findAppointment returns the row by id, or undefined when missing', async () => {
	const db = await makeDb();
	try {
		await db
			.insertInto('appointments')
			.values({
				id: 'a1',
				event_type_id: 'chat',
				start_time: '2099-01-01T15:00:00Z',
				end_time: '2099-01-01T15:30:00Z',
				attendee_name: 'Booker',
				attendee_email: 'booker@example.com',
				attendee_notes: null,
				location: null,
				status: 'confirmed',
				cancel_token: 't1',
				external_event_id: null,
				external_calendar_id: null,
				email_notification_status: null,
				calendar_push_notification_status: null
			})
			.execute();

		const found = await findAppointment(db, 'a1');
		expect(found?.id).toBe('a1');
		expect(found?.status).toBe('confirmed');

		expect(await findAppointment(db, 'ghost')).toBeUndefined();
	} finally {
		await db.destroy();
	}
});
