import { describe, expect, test } from 'vitest';
import { recordNotificationFailure } from './notifications';
import { openDb } from '$lib/server/db';
import { runMigrations } from '$lib/server/db/migrate';

const baseRow = {
	event_type_id: '30-min-chat',
	start_time: '2099-01-01T15:00:00Z',
	end_time: '2099-01-01T15:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_notes: null,
	location: null,
	external_event_id: null,
	external_calendar_id: null,
	notification_status: null,
	status: 'pending' as const,
	cancel_token: 't1'
};

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

async function fetchRow(db: Awaited<ReturnType<typeof makeDb>>, id: string) {
	return db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

describe('recordNotificationFailure', () => {
	test('records email failure when notification_status is null', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a1' })
				.execute();

			await recordNotificationFailure(db, 'a1', 'email');

			const row = await fetchRow(db, 'a1');
			expect(row.notification_status).not.toBeNull();
			const parsed = JSON.parse(row.notification_status!);
			expect(parsed).toEqual({ email: 'failed' });
		} finally {
			await db.destroy();
		}
	});

	test('records calendar_push failure and merges with existing failures', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a2', notification_status: '{"email":"failed"}' })
				.execute();

			await recordNotificationFailure(db, 'a2', 'calendar_push');

			const row = await fetchRow(db, 'a2');
			expect(row.notification_status).not.toBeNull();
			const parsed = JSON.parse(row.notification_status!);
			expect(parsed).toEqual({
				email: 'failed',
				calendar_push: 'failed'
			});
		} finally {
			await db.destroy();
		}
	});

	test('does not error or clear existing when updating already failed key', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a3', notification_status: '{"email":"failed"}' })
				.execute();

			await recordNotificationFailure(db, 'a3', 'email');

			const row = await fetchRow(db, 'a3');
			expect(row.notification_status).not.toBeNull();
			const parsed = JSON.parse(row.notification_status!);
			expect(parsed).toEqual({ email: 'failed' });
		} finally {
			await db.destroy();
		}
	});
});
