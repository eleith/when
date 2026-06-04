import { describe, expect, test } from 'vitest';
import { openDb, parseNotificationStatus, runMigrations } from '@when/db';
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
			notification_status: null,
			status: 'confirmed',
			cancel_token: 't1'
		})
		.execute();
	return db;
}

async function readStatus(db: Awaited<ReturnType<typeof seed>>) {
	const row = await db
		.selectFrom('appointments')
		.select('notification_status')
		.where('id', '=', 'a1')
		.executeTakeFirstOrThrow();
	return parseNotificationStatus(row.notification_status);
}

describe('setNotificationStatus', () => {
	test('records an outcome on a null column', async () => {
		const db = await seed();
		await setNotificationStatus(db, 'a1', 'email', 'ok');
		expect(await readStatus(db)).toEqual({ email: 'ok' });
		await db.destroy();
	});

	test('merges without clobbering sibling keys', async () => {
		const db = await seed();
		await setNotificationStatus(db, 'a1', 'email', 'failed');
		await setNotificationStatus(db, 'a1', 'calendar_push', 'ok');
		expect(await readStatus(db)).toEqual({ email: 'failed', calendar_push: 'ok' });
		await db.destroy();
	});
});
