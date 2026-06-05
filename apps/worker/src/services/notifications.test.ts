import { describe, expect, test } from 'vitest';
import { openDb, runMigrations } from '@when/db';
import { setNotificationStatus } from './notifications.js';

async function seed() {
	const db = openDb(':memory:');
	await runMigrations(db);
	await db
		.insertInto('appointments')
		.values({
			id: 'a1',
			event_type_id: 'chat',
			start_time: '2026-05-01T10:00:00Z',
			end_time: '2026-05-01T10:30:00Z',
			attendee_name: 'A',
			attendee_email: 'a@example.com',
			attendee_notes: null,
			location: null,
			external_event_id: null,
			external_calendar_id: null,
			status: 'confirmed',
			cancel_token: 't1'
		})
		.execute();
	return db;
}

async function readStatus(db: Awaited<ReturnType<typeof seed>>) {
	return db
		.selectFrom('appointments')
		.select(['email_notification_status', 'calendar_push_notification_status'])
		.where('id', '=', 'a1')
		.executeTakeFirstOrThrow();
}

describe('setNotificationStatus', () => {
	test('records an outcome on the channel column', async () => {
		const db = await seed();
		await setNotificationStatus(db, 'a1', 'email', 'ok');
		expect(await readStatus(db)).toEqual({
			email_notification_status: 'ok',
			calendar_push_notification_status: null
		});
		await db.destroy();
	});

	test('each channel writes its own column', async () => {
		const db = await seed();
		await setNotificationStatus(db, 'a1', 'email', 'failed');
		await setNotificationStatus(db, 'a1', 'calendar_push', 'ok');
		expect(await readStatus(db)).toEqual({
			email_notification_status: 'failed',
			calendar_push_notification_status: 'ok'
		});
		await db.destroy();
	});
});
