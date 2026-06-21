import { expect, test } from 'vitest';
import { openDb, runMigrations } from '@when/db';
import {
	confirmAppointment,
	rescheduleAppointmentTransition,
	cancelAppointmentTransition,
	declineAppointmentTransition
} from './transitions';

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
	attendee_answers: null,
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

test('confirmAppointment confirms a pending appointment, queues the sync, bumps the revision', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'pending', cancel_token: 't1' });
		expect(await confirmAppointment(db, '1', '2026-01-01T12:00:00Z')).toEqual({ ok: true });
		const row = await fetchRow(db, '1');
		expect(row.status).toBe('confirmed');
		expect(row.calendar_revision).toBe(1);
		expect(JSON.parse(row.action_log!)).toEqual([
			{ action: 'confirm', actor: 'organizer', at: '2026-01-01T12:00:00Z' }
		]);
	} finally {
		await db.destroy();
	}
});

test('confirmAppointment reports conflict when not pending, not_found when missing', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'confirmed', cancel_token: 't1' });
		expect(await confirmAppointment(db, '1', '2026-01-01T12:00:00Z')).toEqual({
			ok: false,
			reason: 'conflict'
		});
		expect(await confirmAppointment(db, 'ghost', '2026-01-01T12:00:00Z')).toEqual({
			ok: false,
			reason: 'not_found'
		});
	} finally {
		await db.destroy();
	}
});

test('rescheduleAppointmentTransition ends the old row and creates a linked new one at the new time', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'confirmed', cancel_token: 't1', origin_id: '1' });
		const old = await fetchRow(db, '1');

		const result = await rescheduleAppointmentTransition(
			db,
			old,
			'attendee',
			'2026-01-01T13:00:00Z',
			{
				newStart: '2099-02-01T10:00:00Z',
				newEnd: '2099-02-01T10:30:00Z',
				newStatus: 'confirmed',
				eventTypeSnapshot: '{}'
			}
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const next = result.appointment;
		expect(next.id).not.toBe('1');
		expect(next.start_time).toBe('2099-02-01T10:00:00Z');
		expect(next.status).toBe('confirmed');
		expect(next.ics_sequence).toBe(1);
		expect(next.origin_id).toBe('1');

		const expectedLog = [
			{
				action: 'reschedule',
				actor: 'attendee',
				at: '2026-01-01T13:00:00Z',
				payload: {
					field: 'status',
					from: 'confirmed',
					to: 'rescheduled',
					metadata: { next_id: next.id, previous_id: '1' }
				}
			}
		];

		expect(JSON.parse(next.action_log!)).toEqual(expectedLog);

		const ended = await fetchRow(db, '1');
		expect(ended.status).toBe('rescheduled');
		expect(JSON.parse(ended.action_log!)).toEqual(expectedLog);
	} finally {
		await db.destroy();
	}
});

test('rescheduleAppointmentTransition reports conflict when the old row is no longer active', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'confirmed', cancel_token: 't1', origin_id: '1' });
		const old = await fetchRow(db, '1');
		await db
			.updateTable('appointments')
			.set({ status: 'cancelled' })
			.where('id', '=', '1')
			.execute();

		const result = await rescheduleAppointmentTransition(
			db,
			old,
			'attendee',
			'2026-01-01T13:00:00Z',
			{
				newStart: '2099-02-01T10:00:00Z',
				newEnd: '2099-02-01T10:30:00Z',
				newStatus: 'confirmed',
				eventTypeSnapshot: '{}'
			}
		);
		expect(result).toEqual({ ok: false, reason: 'conflict' });
	} finally {
		await db.destroy();
	}
});

test('rescheduleAppointmentTransition saves the reschedule reason note in the action log', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'confirmed', cancel_token: 't1', origin_id: '1' });
		const old = await fetchRow(db, '1');

		const result = await rescheduleAppointmentTransition(
			db,
			old,
			'attendee',
			'2026-01-01T13:00:00Z',
			{
				newStart: '2099-02-01T10:00:00Z',
				newEnd: '2099-02-01T10:30:00Z',
				newStatus: 'confirmed',
				eventTypeSnapshot: '{}',
				reason: 'scheduling conflict'
			}
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const next = result.appointment;

		const expectedLog = [
			{
				action: 'reschedule',
				actor: 'attendee',
				at: '2026-01-01T13:00:00Z',
				payload: {
					field: 'status',
					from: 'confirmed',
					to: 'rescheduled',
					note: 'scheduling conflict',
					metadata: { next_id: next.id, previous_id: '1' }
				}
			}
		];

		expect(JSON.parse(next.action_log!)).toEqual(expectedLog);

		const ended = await fetchRow(db, '1');
		expect(JSON.parse(ended.action_log!)).toEqual(expectedLog);
	} finally {
		await db.destroy();
	}
});

test('cancelAppointmentTransition queues the sync only when there is a published event', async () => {
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

		await cancelAppointmentTransition(
			db,
			'published',
			'attendee',
			'2026-01-01T14:00:00Z',
			'Reason note'
		);
		await cancelAppointmentTransition(db, 'unpublished', 'organizer', '2026-01-01T14:05:00Z');

		const pub = await fetchRow(db, 'published');
		expect(pub.status).toBe('cancelled');
		expect(pub.calendar_revision).toBe(1);
		expect(JSON.parse(pub.action_log!)).toEqual([
			{
				action: 'cancel',
				actor: 'attendee',
				at: '2026-01-01T14:00:00Z',
				payload: { note: 'Reason note' }
			}
		]);

		const unpub = await fetchRow(db, 'unpublished');
		expect(unpub.status).toBe('cancelled');
		expect(JSON.parse(unpub.action_log!)).toEqual([
			{
				action: 'cancel',
				actor: 'organizer',
				at: '2026-01-01T14:05:00Z'
			}
		]);
	} finally {
		await db.destroy();
	}
});

test('declineAppointmentTransition declines a pending request; no event to remove when none was published', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'pending', cancel_token: 't1' });
		expect(await declineAppointmentTransition(db, '1', '2026-01-01T15:00:00Z')).toEqual({
			ok: true
		});
		const row = await fetchRow(db, '1');
		expect(row.status).toBe('declined');
		expect(JSON.parse(row.action_log!)).toEqual([
			{ action: 'decline', actor: 'organizer', at: '2026-01-01T15:00:00Z' }
		]);
		expect(await declineAppointmentTransition(db, '1', '2026-01-01T15:00:00Z')).toEqual({
			ok: false,
			reason: 'conflict'
		});
	} finally {
		await db.destroy();
	}
});

test('declineAppointmentTransition queues a delete when a re-approval revert carries an inherited event', async () => {
	const db = await makeDb();
	try {
		await insert(db, {
			id: '1',
			status: 'pending',
			cancel_token: 't1',
			external_event_id: 'evt-1',
			external_calendar_id: 'work'
		});
		expect(await declineAppointmentTransition(db, '1', '2026-01-01T15:00:00Z')).toEqual({
			ok: true
		});
		const row = await fetchRow(db, '1');
		expect(row.status).toBe('declined');
		expect(row.calendar_revision).toBe(1);
		expect(JSON.parse(row.action_log!)).toEqual([
			{ action: 'decline', actor: 'organizer', at: '2026-01-01T15:00:00Z' }
		]);
	} finally {
		await db.destroy();
	}
});
