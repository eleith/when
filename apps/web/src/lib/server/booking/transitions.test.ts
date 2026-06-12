import { expect, test } from 'vitest';
import { openDb, runMigrations } from '@when/db';
import { confirmBooking, rescheduleBooking, cancelBooking, declineBooking } from './transitions';

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

const baseRow = {
	event_type_id: 'chat',
	start_time: '2099-01-01T15:00:00Z',
	end_time: '2099-01-01T15:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_notes: null,
	location: null,
	external_event_id: null,
	external_calendar_id: null,
	email_notification_status: null,
	calendar_push_notification_status: null
};

const insert = (db: Awaited<ReturnType<typeof makeDb>>, over: Record<string, unknown>) =>
	db
		.insertInto('appointments')
		.values({ ...baseRow, ...over } as never)
		.execute();

const fetchRow = (db: Awaited<ReturnType<typeof makeDb>>, id: string) =>
	db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

test('confirmBooking confirms a pending booking, queues the sync, bumps the revision', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'pending', cancel_token: 't1' });
		expect(await confirmBooking(db, '1')).toEqual({ ok: true });
		const row = await fetchRow(db, '1');
		expect(row.status).toBe('confirmed');
		expect(row.calendar_push_notification_status).toBe('queued');
		expect(row.calendar_revision).toBe(1);
	} finally {
		await db.destroy();
	}
});

test('confirmBooking reports conflict when not pending, not_found when missing', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'confirmed', cancel_token: 't1' });
		expect(await confirmBooking(db, '1')).toEqual({ ok: false, reason: 'conflict' });
		expect(await confirmBooking(db, 'ghost')).toEqual({ ok: false, reason: 'not_found' });
	} finally {
		await db.destroy();
	}
});

test('rescheduleBooking moves the time, keeps status, bumps ics + revision', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'confirmed', cancel_token: 't1' });
		expect(
			await rescheduleBooking(db, '1', {
				newStart: '2099-02-01T10:00:00Z',
				newEnd: '2099-02-01T10:30:00Z'
			})
		).toEqual({ ok: true });
		const row = await fetchRow(db, '1');
		expect(row.start_time).toBe('2099-02-01T10:00:00Z');
		expect(row.status).toBe('confirmed');
		expect(row.ics_sequence).toBe(1);
		expect(row.calendar_push_notification_status).toBe('queued');
		expect(row.calendar_revision).toBe(1);
	} finally {
		await db.destroy();
	}
});

test('cancelBooking queues the sync only when there is a published event', async () => {
	const db = await makeDb();
	try {
		await insert(db, {
			id: 'published',
			status: 'confirmed',
			cancel_token: 't1',
			external_event_id: 'ext-1',
			external_calendar_id: 'work'
		});
		await insert(db, {
			id: 'unpublished',
			status: 'confirmed',
			cancel_token: 't2',
			start_time: '2099-01-02T15:00:00Z',
			end_time: '2099-01-02T15:30:00Z'
		});

		await cancelBooking(db, 'published');
		await cancelBooking(db, 'unpublished');

		const pub = await fetchRow(db, 'published');
		expect(pub.status).toBe('cancelled');
		expect(pub.calendar_push_notification_status).toBe('queued');
		expect(pub.calendar_revision).toBe(1);

		const unpub = await fetchRow(db, 'unpublished');
		expect(unpub.status).toBe('cancelled');
		expect(unpub.calendar_push_notification_status).toBeNull();
	} finally {
		await db.destroy();
	}
});

test('declineBooking declines a pending request without bumping the revision', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'pending', cancel_token: 't1' });
		expect(await declineBooking(db, '1')).toEqual({ ok: true });
		const row = await fetchRow(db, '1');
		expect(row.status).toBe('declined');
		expect(row.calendar_revision).toBe(0);
		expect(await declineBooking(db, '1')).toEqual({ ok: false, reason: 'conflict' });
	} finally {
		await db.destroy();
	}
});
