import { expect, test } from 'vitest';
import { openDb } from './index.js';
import { runMigrations } from './migrate.js';
import {
	replaceCalendarBusy,
	listOwnEventIds,
	getBusyIntervals,
	listUpcomingActiveAppointments,
	setPossibleConflicts,
	listOutOfSyncAppointments,
	recordCalendarEventReference,
	recordCalendarEventDeletion,
	listActiveAppointmentsForCalendarEvent,
	markSynced
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
	guest_name: 'A',
	guest_email: 'a@example.com',
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
		const intervals = await getBusyIntervals(db, [], {
			start: '2026-05-01T00:00:00Z',
			end: '2026-05-02T00:00:00Z'
		});
		expect(intervals).toEqual([]);
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

test.each([
	['current', 2, 'confirmed', 2],
	['stale', 3, 'confirmed', 1],
	['purged', 2, 'purged', 1]
] as const)(
	'markSynced only updates sync evidence for a current non-purged row: %s',
	async (_name, revision, status, synced) => {
		const db = await freshDb();
		try {
			await db
				.insertInto('appointments')
				.values(
					appt({
						calendar_revision: revision,
						calendar_synced_revision: 1,
						status,
						external_event_id: 'event',
						external_calendar_id: 'work',
						video_chat: 'sip:selected@example.com',
						video_chat_request: 'suppress'
					})
				)
				.execute();
			const before = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();
			await markSynced(db, 'a', 2, { calendarId: 'work', eventId: 'event' });
			const after = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();
			expect(after).toEqual({ ...before, calendar_synced_revision: synced });
		} finally {
			await db.destroy();
		}
	}
);

test.each([
	['matching pair', 'work', 'event', 'work', 'event', true],
	['changed calendar', 'other', 'event', 'work', 'event', false],
	['changed event', 'work', 'other', 'work', 'event', false],
	['matching empty pair', null, null, null, null, true],
	['matching calendar only', 'work', null, 'work', null, true],
	['matching event only', null, 'event', null, 'event', true],
	['calendar filled since receipt', 'work', 'event', null, 'event', false],
	['event filled since receipt', 'work', 'event', 'work', null, false],
	['calendar cleared since receipt', null, 'event', 'work', 'event', false],
	['event cleared since receipt', 'work', null, 'work', 'event', false]
] as const)(
	'markSynced requires a null-safe reference match: %s',
	async (_name, calendarId, eventId, expectedCalendarId, expectedEventId, matches) => {
		const db = await freshDb();
		try {
			await db
				.insertInto('appointments')
				.values(
					appt({
						calendar_revision: 2,
						calendar_synced_revision: 1,
						external_calendar_id: calendarId,
						external_event_id: eventId
					})
				)
				.execute();
			const before = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();

			await markSynced(db, 'a', 2, {
				calendarId: expectedCalendarId,
				eventId: expectedEventId
			});

			const after = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();
			expect(after).toEqual({ ...before, calendar_synced_revision: matches ? 2 : 1 });
		} finally {
			await db.destroy();
		}
	}
);

const reference = { calendarId: 'work', eventId: 'event' };

test.each([
	['current pair and revision', 2, 'cancelled', 'work', 'event', true],
	['stale revision', 3, 'cancelled', 'work', 'event', false],
	['changed calendar', 2, 'cancelled', 'other', 'event', false],
	['changed event', 2, 'cancelled', 'work', 'other', false],
	['missing calendar', 2, 'cancelled', null, 'event', false],
	['missing event', 2, 'cancelled', 'work', null, false],
	['purged row', 2, 'purged', 'work', 'event', false]
] as const)(
	'deletion receipt requires the current complete pair and revision: %s',
	async (_name, revision, status, calendarId, eventId, matches) => {
		const db = await freshDb();
		try {
			await db
				.insertInto('appointments')
				.values(
					appt({
						status,
						calendar_revision: revision,
						calendar_synced_revision: 1,
						external_calendar_id: calendarId,
						external_event_id: eventId,
						ics_sequence: 4,
						video_chat: 'https://selected.example/room',
						video_chat_request: 'suppress'
					})
				)
				.execute();
			const before = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();

			await recordCalendarEventDeletion(db, 'a', 2, reference);

			const after = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();
			expect(after).toEqual(
				matches
					? {
							...before,
							external_calendar_id: null,
							external_event_id: null,
							calendar_synced_revision: 2
						}
					: before
			);
		} finally {
			await db.destroy();
		}
	}
);

test('replaying a deletion receipt is a no-op and cannot acknowledge a replacement reference', async () => {
	const db = await freshDb();
	try {
		await db
			.insertInto('appointments')
			.values(
				appt({
					status: 'cancelled',
					calendar_revision: 2,
					calendar_synced_revision: 1,
					external_calendar_id: reference.calendarId,
					external_event_id: reference.eventId
				})
			)
			.execute();
		await recordCalendarEventDeletion(db, 'a', 2, reference);
		const recorded = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();

		await recordCalendarEventDeletion(db, 'a', 2, reference);

		const replayed = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();
		expect(replayed).toEqual(recorded);
		expect(replayed.calendar_synced_revision).toBe(2);
		expect(replayed.external_calendar_id).toBeNull();
		expect(replayed.external_event_id).toBeNull();

		await recordCalendarEventReference(db, 'a', { calendarId: 'work', eventId: 'replacement' });
		const replacement = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();
		expect(replacement.calendar_synced_revision).toBeNull();

		await recordCalendarEventDeletion(db, 'a', 2, reference);

		const after = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();
		expect(after).toEqual(replacement);
	} finally {
		await db.destroy();
	}
});

test('recording a new calendar reference invalidates only sync evidence', async () => {
	const db = await freshDb();
	try {
		await db
			.insertInto('appointments')
			.values(
				appt({
					calendar_revision: 7,
					calendar_synced_revision: 7,
					ics_sequence: 4,
					video_chat: 'https://selected.example/room',
					video_chat_request: 'suppress'
				})
			)
			.execute();
		const before = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();

		await recordCalendarEventReference(db, 'a', reference);

		const after = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();
		expect(after).toEqual({
			...before,
			external_event_id: 'event',
			external_calendar_id: 'work',
			calendar_synced_revision: null
		});
	} finally {
		await db.destroy();
	}
});

test.each([
	['matching event', 'event', null, true],
	['matching calendar', null, 'work', true],
	['conflicting event', 'other-event', null, false],
	['conflicting calendar', null, 'other-calendar', false],
	['conflicting pair', 'other-event', 'other-calendar', false]
] as const)('reference selection respects %s', async (_name, eventId, calendarId, selected) => {
	const db = await freshDb();
	try {
		await db
			.insertInto('appointments')
			.values(
				appt({
					external_event_id: eventId,
					external_calendar_id: calendarId,
					calendar_synced_revision: 3
				})
			)
			.execute();
		const before = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();

		await recordCalendarEventReference(db, 'a', reference);

		const after = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();
		if (selected) {
			expect(after).toEqual({
				...before,
				external_event_id: 'event',
				external_calendar_id: 'work',
				calendar_synced_revision: null
			});
		} else {
			expect(after).toEqual(before);
		}
	} finally {
		await db.destroy();
	}
});

test('recording the same reference preserves already-recorded sync evidence', async () => {
	const db = await freshDb();
	try {
		await db
			.insertInto('appointments')
			.values(
				appt({
					external_event_id: 'event',
					external_calendar_id: 'work',
					calendar_revision: 7,
					calendar_synced_revision: 7
				})
			)
			.execute();
		const before = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();

		await recordCalendarEventReference(db, 'a', reference);

		const after = await db.selectFrom('appointments').selectAll().executeTakeFirstOrThrow();
		expect(after).toEqual(before);
	} finally {
		await db.destroy();
	}
});

test('lists pending and confirmed appointments for the exact calendar event', async () => {
	const db = await freshDb();
	try {
		await db
			.insertInto('appointments')
			.values([
				appt({
					id: 'pending',
					status: 'pending',
					external_event_id: 'event',
					external_calendar_id: 'work'
				}),
				appt({
					id: 'confirmed',
					cancel_token: 'confirmed',
					start_time: '2026-05-01T11:00:00Z',
					end_time: '2026-05-01T11:30:00Z',
					external_event_id: 'event',
					external_calendar_id: 'work'
				}),
				appt({
					id: 'cancelled',
					status: 'cancelled',
					cancel_token: 'cancelled',
					external_event_id: 'event',
					external_calendar_id: 'work'
				}),
				appt({
					id: 'other-calendar',
					cancel_token: 'other',
					start_time: '2026-05-01T12:00:00Z',
					end_time: '2026-05-01T12:30:00Z',
					external_event_id: 'event',
					external_calendar_id: 'other'
				}),
				appt({
					id: 'rescheduled',
					status: 'rescheduled',
					cancel_token: 'rescheduled',
					external_event_id: 'old-event',
					external_calendar_id: 'work'
				})
			])
			.execute();

		const appointments = await listActiveAppointmentsForCalendarEvent(db, reference);
		const otherCalendar = await listActiveAppointmentsForCalendarEvent(db, {
			...reference,
			calendarId: 'other'
		});
		const rescheduled = await listActiveAppointmentsForCalendarEvent(db, {
			...reference,
			eventId: 'old-event'
		});

		expect(appointments.map((row) => row.id).sort()).toEqual(['confirmed', 'pending']);
		expect(otherCalendar.map((row) => row.id)).toEqual(['other-calendar']);
		expect(rescheduled).toEqual([]);

		await db
			.updateTable('appointments')
			.set({ status: 'cancelled' })
			.where('id', '=', 'confirmed')
			.execute();
		const pendingOnly = await listActiveAppointmentsForCalendarEvent(db, reference);
		expect(pendingOnly.map((row) => row.id)).toEqual(['pending']);
	} finally {
		await db.destroy();
	}
});
