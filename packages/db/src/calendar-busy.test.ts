import { expect, test } from 'vitest';
import { openDb } from './index.js';
import { runMigrations } from './migrate.js';
import {
	replaceCalendarBusy,
	recordRefreshResult,
	listOwnEventIds,
	getBusyIntervals,
	listUpcomingActiveAppointments,
	setPossibleConflicts,
	listOutOfSyncAppointments,
	markSynced,
	listCalendarSyncStatus,
	setCalendarHealth,
	listPublishFailingAppointments
} from './calendar-busy.js';

async function freshDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

const appt = (over: Record<string, unknown>) => ({
	id: 'a',
	event_type_id: 'chat',
	start_time: '2026-05-01T10:00:00Z',
	end_time: '2026-05-01T10:30:00Z',
	attendee_name: 'A',
	attendee_email: 'a@example.com',
	location: null,
	status: 'confirmed' as const,
	cancel_token: 't',
	external_event_id: null,
	external_calendar_id: null,
	...over
});

test('replaceCalendarBusy replaces the whole set for a calendar', async () => {
	const db = await freshDb();
	try {
		await replaceCalendarBusy(db, 'work', [
			{ start: '2026-05-01T09:00:00Z', end: '2026-05-01T09:30:00Z' },
			{ start: '2026-05-01T11:00:00Z', end: '2026-05-01T11:30:00Z' }
		]);
		await replaceCalendarBusy(db, 'work', [
			{ start: '2026-05-02T09:00:00Z', end: '2026-05-02T09:30:00Z' }
		]);
		const rows = await db
			.selectFrom('external_calendar_busy')
			.selectAll()
			.where('calendar_id', '=', 'work')
			.execute();
		expect(rows.map((r) => r.start_time)).toEqual(['2026-05-02T09:00:00Z']);
	} finally {
		await db.destroy();
	}
});

test('replaceCalendarBusy with an empty set clears the calendar', async () => {
	const db = await freshDb();
	try {
		await replaceCalendarBusy(db, 'work', [
			{ start: '2026-05-01T09:00:00Z', end: '2026-05-01T09:30:00Z' }
		]);
		await replaceCalendarBusy(db, 'work', []);
		const rows = await db.selectFrom('external_calendar_busy').selectAll().execute();
		expect(rows).toHaveLength(0);
	} finally {
		await db.destroy();
	}
});

test('replaceCalendarBusy leaves other calendars untouched', async () => {
	const db = await freshDb();
	try {
		await replaceCalendarBusy(db, 'work', [
			{ start: '2026-05-01T09:00:00Z', end: '2026-05-01T09:30:00Z' }
		]);
		await replaceCalendarBusy(db, 'home', [
			{ start: '2026-05-01T12:00:00Z', end: '2026-05-01T12:30:00Z' }
		]);
		await replaceCalendarBusy(db, 'work', []);
		const home = await db
			.selectFrom('external_calendar_busy')
			.selectAll()
			.where('calendar_id', '=', 'home')
			.execute();
		expect(home).toHaveLength(1);
	} finally {
		await db.destroy();
	}
});

test('recordRefreshResult: success sets both timestamps and clears error', async () => {
	const db = await freshDb();
	try {
		await recordRefreshResult(db, 'work', { at: 't1', error: 'boom' });
		await recordRefreshResult(db, 'work', { at: 't2' });
		const row = await db
			.selectFrom('calendar_sync_status')
			.selectAll()
			.where('calendar_id', '=', 'work')
			.executeTakeFirstOrThrow();
		expect(row.last_refresh_at).toBe('t2');
		expect(row.last_successful_refresh_at).toBe('t2');
		expect(row.error).toBeNull();
	} finally {
		await db.destroy();
	}
});

test('recordRefreshResult: failure records error but keeps the last success time', async () => {
	const db = await freshDb();
	try {
		await recordRefreshResult(db, 'work', { at: 't1' });
		await recordRefreshResult(db, 'work', { at: 't2', error: 'down' });
		const row = await db
			.selectFrom('calendar_sync_status')
			.selectAll()
			.where('calendar_id', '=', 'work')
			.executeTakeFirstOrThrow();
		expect(row.last_refresh_at).toBe('t2');
		expect(row.last_successful_refresh_at).toBe('t1');
		expect(row.error).toBe('down');
	} finally {
		await db.destroy();
	}
});

test('listOwnEventIds returns ids for the calendar, including cancelled, excluding others', async () => {
	const db = await freshDb();
	try {
		await db
			.insertInto('appointments')
			.values([
				appt({
					id: '1',
					cancel_token: 't1',
					external_event_id: 'e1',
					external_calendar_id: 'work'
				}),
				appt({
					id: '2',
					start_time: '2026-05-01T11:00:00Z',
					end_time: '2026-05-01T11:30:00Z',
					cancel_token: 't2',
					status: 'cancelled',
					external_event_id: 'e2',
					external_calendar_id: 'work'
				}),
				appt({
					id: '3',
					start_time: '2026-05-01T12:00:00Z',
					end_time: '2026-05-01T12:30:00Z',
					cancel_token: 't3',
					external_event_id: 'e3',
					external_calendar_id: 'home'
				}),
				appt({
					id: '4',
					start_time: '2026-05-01T13:00:00Z',
					end_time: '2026-05-01T13:30:00Z',
					cancel_token: 't4'
				})
			])
			.execute();
		const ids = await listOwnEventIds(db, 'work');
		expect(ids.sort()).toEqual(['e1', 'e2']);
	} finally {
		await db.destroy();
	}
});

test('getBusyIntervals returns overlapping intervals for the given calendars only', async () => {
	const db = await freshDb();
	try {
		await replaceCalendarBusy(db, 'work', [
			{ start: '2026-05-01T09:00:00Z', end: '2026-05-01T10:00:00Z' },
			{ start: '2026-06-01T09:00:00Z', end: '2026-06-01T10:00:00Z' }
		]);
		await replaceCalendarBusy(db, 'home', [
			{ start: '2026-05-01T12:00:00Z', end: '2026-05-01T13:00:00Z' }
		]);
		const intervals = await getBusyIntervals(db, ['work'], {
			start: '2026-05-01T00:00:00Z',
			end: '2026-05-02T00:00:00Z'
		});
		expect(intervals).toEqual([{ start: '2026-05-01T09:00:00Z', end: '2026-05-01T10:00:00Z' }]);
	} finally {
		await db.destroy();
	}
});

test('getBusyIntervals includes intervals that straddle the window edges', async () => {
	const db = await freshDb();
	try {
		await replaceCalendarBusy(db, 'work', [
			{ start: '2026-04-30T23:00:00Z', end: '2026-05-01T01:00:00Z' },
			{ start: '2026-05-01T23:30:00Z', end: '2026-05-02T00:30:00Z' }
		]);
		const intervals = await getBusyIntervals(db, ['work'], {
			start: '2026-05-01T00:00:00Z',
			end: '2026-05-02T00:00:00Z'
		});
		expect(intervals).toHaveLength(2);
	} finally {
		await db.destroy();
	}
});

test('getBusyIntervals returns [] for no calendars', async () => {
	const db = await freshDb();
	try {
		await replaceCalendarBusy(db, 'work', [
			{ start: '2026-05-01T09:00:00Z', end: '2026-05-01T10:00:00Z' }
		]);
		expect(
			await getBusyIntervals(db, [], { start: '2026-05-01T00:00:00Z', end: '2026-05-02T00:00:00Z' })
		).toEqual([]);
	} finally {
		await db.destroy();
	}
});

test('listUpcomingActiveAppointments returns only upcoming pending + confirmed', async () => {
	const db = await freshDb();
	try {
		const now = '2026-05-01T12:00:00Z';
		await db
			.insertInto('appointments')
			.values([
				appt({
					id: 'c-future',
					cancel_token: 'a',
					status: 'confirmed',
					start_time: '2026-05-01T14:00:00Z',
					end_time: '2026-05-01T14:30:00Z'
				}),
				appt({
					id: 'p-future',
					cancel_token: 'b',
					status: 'pending',
					start_time: '2026-05-02T10:00:00Z',
					end_time: '2026-05-02T10:30:00Z'
				}),
				appt({
					id: 'cancelled',
					cancel_token: 'c',
					status: 'cancelled',
					start_time: '2026-05-01T15:00:00Z',
					end_time: '2026-05-01T15:30:00Z'
				}),
				appt({
					id: 'past',
					cancel_token: 'd',
					status: 'confirmed',
					start_time: '2026-04-30T10:00:00Z',
					end_time: '2026-04-30T10:30:00Z'
				})
			])
			.execute();
		const upcoming = await listUpcomingActiveAppointments(db, now);
		expect(upcoming.map((a) => a.id).sort()).toEqual(['c-future', 'p-future']);
	} finally {
		await db.destroy();
	}
});

test('setPossibleConflicts flags and clears ids, no-ops on empty', async () => {
	const db = await freshDb();
	try {
		await db
			.insertInto('appointments')
			.values([
				appt({ id: '1', cancel_token: 'a' }),
				appt({
					id: '2',
					cancel_token: 'b',
					start_time: '2026-05-01T11:00:00Z',
					end_time: '2026-05-01T11:30:00Z'
				})
			])
			.execute();
		await setPossibleConflicts(db, ['1'], []);
		await setPossibleConflicts(db, [], []);
		let rows = await db
			.selectFrom('appointments')
			.select(['id', 'has_possible_conflict'])
			.orderBy('id')
			.execute();
		expect(rows).toEqual([
			{ id: '1', has_possible_conflict: 1 },
			{ id: '2', has_possible_conflict: 0 }
		]);
		await setPossibleConflicts(db, ['2'], ['1']);
		rows = await db
			.selectFrom('appointments')
			.select(['id', 'has_possible_conflict'])
			.orderBy('id')
			.execute();
		expect(rows).toEqual([
			{ id: '1', has_possible_conflict: 0 },
			{ id: '2', has_possible_conflict: 1 }
		]);
	} finally {
		await db.destroy();
	}
});

test('listOutOfSyncAppointments returns rows whose revision differs from synced, including never-synced', async () => {
	const db = await freshDb();
	try {
		await db
			.insertInto('appointments')
			.values([
				appt({
					id: 'bumped',
					cancel_token: 'a',
					calendar_revision: 1,
					calendar_synced_revision: 0
				}),
				appt({
					id: 'in-sync',
					cancel_token: 'b',
					start_time: '2026-05-01T11:00:00Z',
					end_time: '2026-05-01T11:30:00Z',
					calendar_revision: 0,
					calendar_synced_revision: 0
				}),
				appt({
					id: 'never-synced',
					cancel_token: 'c',
					start_time: '2026-05-01T12:00:00Z',
					end_time: '2026-05-01T12:30:00Z',
					calendar_revision: 0
				}),
				appt({
					id: 'purged',
					cancel_token: 'd',
					status: 'purged',
					start_time: '2026-05-01T13:00:00Z',
					end_time: '2026-05-01T13:30:00Z',
					calendar_revision: 1,
					calendar_synced_revision: 0
				})
			])
			.execute();
		const rows = await listOutOfSyncAppointments(db);
		// purged rows are owned by the purge workflow, not the reconcile sweep
		expect(rows.map((r) => r.id).sort()).toEqual(['bumped', 'never-synced']);
	} finally {
		await db.destroy();
	}
});

test('markSynced sets the synced revision and any provided fields, leaving others untouched', async () => {
	const db = await freshDb();
	try {
		await db
			.insertInto('appointments')
			.values(appt({ id: '1', cancel_token: 'a' }))
			.execute();
		await markSynced(db, '1', 2, { external_event_id: 'ext', external_calendar_id: 'cal' });
		let row = await db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', '1')
			.executeTakeFirstOrThrow();
		expect(row.calendar_synced_revision).toBe(2);
		expect(row.external_event_id).toBe('ext');
		expect(row.external_calendar_id).toBe('cal');

		await markSynced(db, '1', 3);
		row = await db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', '1')
			.executeTakeFirstOrThrow();
		expect(row.calendar_synced_revision).toBe(3);
		expect(row.external_event_id).toBe('ext');
	} finally {
		await db.destroy();
	}
});

test('setCalendarHealth updates the row that listCalendarSyncStatus returns', async () => {
	const db = await freshDb();
	try {
		await recordRefreshResult(db, 'work', { at: '2026-05-01T10:00:00Z' });
		await setCalendarHealth(db, 'work', {
			health: 'bad',
			changedAt: '2026-05-01T11:00:00Z',
			reason: 'no successful refresh in 2h'
		});
		const rows = await listCalendarSyncStatus(db);
		expect(rows).toHaveLength(1);
		expect(rows[0].calendar_id).toBe('work');
		expect(rows[0].health).toBe('bad');
		expect(rows[0].health_changed_at).toBe('2026-05-01T11:00:00Z');
		expect(rows[0].health_reason).toBe('no successful refresh in 2h');
	} finally {
		await db.destroy();
	}
});

test('listPublishFailingAppointments returns only failures older than the cutoff', async () => {
	const db = await freshDb();
	try {
		await db
			.insertInto('appointments')
			.values([
				appt({ id: 'old', cancel_token: 'a', calendar_push_failing_since: '2026-05-01T10:00:00Z' }),
				appt({
					id: 'recent',
					cancel_token: 'b',
					start_time: '2026-05-01T11:00:00Z',
					end_time: '2026-05-01T11:30:00Z',
					calendar_push_failing_since: '2026-05-01T10:50:00Z'
				}),
				appt({
					id: 'not-failing',
					cancel_token: 'c',
					start_time: '2026-05-01T12:00:00Z',
					end_time: '2026-05-01T12:30:00Z'
				})
			])
			.execute();
		const failing = await listPublishFailingAppointments(db, '2026-05-01T10:30:00Z');
		expect(failing.map((a) => a.id)).toEqual(['old']);
	} finally {
		await db.destroy();
	}
});
