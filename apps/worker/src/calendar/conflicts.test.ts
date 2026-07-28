import { expect, test } from 'vitest';
import pino from 'pino';
import type { WhenConfiguration } from '@when/config';
import { openDb, runMigrations, replaceCalendarBusy } from '@when/db';
import type { Logger } from '../services/logger.js';
import type { WorkerContext } from '../services/context.js';
import { flagConflicts } from './conflicts.js';

const inst = (s: string) => Temporal.Instant.from(s);
const silent: Logger = pino({ level: 'silent' });

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
	calendar_revision: 0,
	ics_sequence: 0,
	has_possible_conflict: 0,
	meeting_snapshot: null,
	guest_answers: null,
	guest_timezone: 'UTC',
	created_at: '',
	updated_at: '',
	...over
});

async function ctxWith(config: Partial<WhenConfiguration>): Promise<WorkerContext> {
	const db = openDb(':memory:');
	await runMigrations(db);
	return {
		config: config as WhenConfiguration,
		logger: silent,
		db,
		mailer: { send: async () => ({ ok: true as const }) }
	};
}

test('flags confirmed + pending appointments overlapping the mirror, clears the rest', async () => {
	const ctx = await ctxWith({
		meetings: [
			{ name: 'chat', busy_calendars: ['work'] }
		] as unknown as WhenConfiguration['meetings']
	});
	try {
		await replaceCalendarBusy(ctx.db, 'work', [
			{ start: '2026-05-01T14:00:00Z', end: '2026-05-01T15:00:00Z' }
		]);
		await ctx.db
			.insertInto('appointments')
			.values([
				appt({
					id: 'overlap-c',
					cancel_token: 'a',
					status: 'confirmed',
					start_time: '2026-05-01T14:30:00Z',
					end_time: '2026-05-01T15:00:00Z'
				}),
				appt({
					id: 'overlap-p',
					cancel_token: 'b',
					status: 'pending',
					start_time: '2026-05-01T13:30:00Z',
					end_time: '2026-05-01T14:30:00Z'
				}),
				appt({
					id: 'clear',
					cancel_token: 'c',
					status: 'confirmed',
					start_time: '2026-05-01T16:00:00Z',
					end_time: '2026-05-01T16:30:00Z'
				})
			])
			.execute();

		await flagConflicts(ctx, { now: inst('2026-05-01T00:00:00Z') });

		const rows = await ctx.db
			.selectFrom('appointments')
			.select(['id', 'has_possible_conflict'])
			.orderBy('id')
			.execute();
		expect(rows).toEqual([
			{ id: 'clear', has_possible_conflict: 0 },
			{ id: 'overlap-c', has_possible_conflict: 1 },
			{ id: 'overlap-p', has_possible_conflict: 1 }
		]);
	} finally {
		await ctx.db.destroy();
	}
});

test('clears a previously-flagged appointment once the overlap is gone', async () => {
	const ctx = await ctxWith({
		meetings: [
			{ name: 'chat', busy_calendars: ['work'] }
		] as unknown as WhenConfiguration['meetings']
	});
	try {
		await ctx.db
			.insertInto('appointments')
			.values(
				appt({
					id: '1',
					status: 'confirmed',
					start_time: '2026-05-01T14:30:00Z',
					end_time: '2026-05-01T15:00:00Z',
					has_possible_conflict: 1
				})
			)
			.execute();
		// Mirror is empty (the conflicting event went away).
		await flagConflicts(ctx, { now: inst('2026-05-01T00:00:00Z') });
		const row = await ctx.db
			.selectFrom('appointments')
			.select('has_possible_conflict')
			.where('id', '=', '1')
			.executeTakeFirstOrThrow();
		expect(row.has_possible_conflict).toBe(0);
	} finally {
		await ctx.db.destroy();
	}
});

test('an event type with no conflict calendars is never flagged', async () => {
	const ctx = await ctxWith({
		meetings: [{ name: 'chat', busy_calendars: [] }] as unknown as WhenConfiguration['meetings']
	});
	try {
		await replaceCalendarBusy(ctx.db, 'work', [
			{ start: '2026-05-01T14:00:00Z', end: '2026-05-01T15:00:00Z' }
		]);
		await ctx.db
			.insertInto('appointments')
			.values(
				appt({
					id: '1',
					status: 'confirmed',
					start_time: '2026-05-01T14:30:00Z',
					end_time: '2026-05-01T15:00:00Z'
				})
			)
			.execute();
		await flagConflicts(ctx, { now: inst('2026-05-01T00:00:00Z') });
		const row = await ctx.db
			.selectFrom('appointments')
			.select('has_possible_conflict')
			.where('id', '=', '1')
			.executeTakeFirstOrThrow();
		expect(row.has_possible_conflict).toBe(0);
	} finally {
		await ctx.db.destroy();
	}
});

test('flags two appointments that overlap each other, with no busy calendars', async () => {
	const ctx = await ctxWith({
		meetings: [
			{ name: 'chat', busy_calendars: [] },
			{ name: 'lunch', busy_calendars: [] }
		] as unknown as WhenConfiguration['meetings']
	});
	try {
		await ctx.db
			.insertInto('appointments')
			.values([
				appt({
					id: 'chat-1',
					cancel_token: 'a',
					event_type_id: 'chat',
					start_time: '2026-05-01T14:00:00Z',
					end_time: '2026-05-01T15:00:00Z'
				}),
				appt({
					id: 'lunch-1',
					cancel_token: 'b',
					event_type_id: 'lunch',
					start_time: '2026-05-01T14:30:00Z',
					end_time: '2026-05-01T15:30:00Z'
				}),
				appt({
					id: 'alone',
					cancel_token: 'c',
					event_type_id: 'chat',
					start_time: '2026-05-01T17:00:00Z',
					end_time: '2026-05-01T17:30:00Z'
				})
			])
			.execute();

		await flagConflicts(ctx, { now: inst('2026-05-01T00:00:00Z') });

		const rows = await ctx.db
			.selectFrom('appointments')
			.select(['id', 'has_possible_conflict'])
			.orderBy('id')
			.execute();
		expect(rows).toEqual([
			{ id: 'alone', has_possible_conflict: 0 },
			{ id: 'chat-1', has_possible_conflict: 1 },
			{ id: 'lunch-1', has_possible_conflict: 1 }
		]);
	} finally {
		await ctx.db.destroy();
	}
});

test('back-to-back appointments are not a conflict', async () => {
	const ctx = await ctxWith({
		meetings: [
			{ name: 'chat', busy_calendars: [] },
			{ name: 'lunch', busy_calendars: [] }
		] as unknown as WhenConfiguration['meetings']
	});
	try {
		await ctx.db
			.insertInto('appointments')
			.values([
				appt({
					id: 'first',
					cancel_token: 'a',
					event_type_id: 'chat',
					start_time: '2026-05-01T14:00:00Z',
					end_time: '2026-05-01T14:30:00Z'
				}),
				appt({
					id: 'second',
					cancel_token: 'b',
					event_type_id: 'lunch',
					start_time: '2026-05-01T14:30:00Z',
					end_time: '2026-05-01T15:00:00Z'
				})
			])
			.execute();

		await flagConflicts(ctx, { now: inst('2026-05-01T00:00:00Z') });

		const rows = await ctx.db
			.selectFrom('appointments')
			.select(['id', 'has_possible_conflict'])
			.orderBy('id')
			.execute();
		expect(rows).toEqual([
			{ id: 'first', has_possible_conflict: 0 },
			{ id: 'second', has_possible_conflict: 0 }
		]);
	} finally {
		await ctx.db.destroy();
	}
});

test('clears the survivor once the overlapping appointment is cancelled', async () => {
	const ctx = await ctxWith({
		meetings: [
			{ name: 'chat', busy_calendars: [] },
			{ name: 'lunch', busy_calendars: [] }
		] as unknown as WhenConfiguration['meetings']
	});
	try {
		await ctx.db
			.insertInto('appointments')
			.values([
				appt({
					id: 'kept',
					cancel_token: 'a',
					event_type_id: 'chat',
					start_time: '2026-05-01T14:00:00Z',
					end_time: '2026-05-01T15:00:00Z',
					has_possible_conflict: 1
				}),
				appt({
					id: 'gone',
					cancel_token: 'b',
					event_type_id: 'lunch',
					status: 'cancelled',
					start_time: '2026-05-01T14:30:00Z',
					end_time: '2026-05-01T15:30:00Z',
					has_possible_conflict: 1
				})
			])
			.execute();

		await flagConflicts(ctx, { now: inst('2026-05-01T00:00:00Z') });

		const row = await ctx.db
			.selectFrom('appointments')
			.select('has_possible_conflict')
			.where('id', '=', 'kept')
			.executeTakeFirstOrThrow();
		expect(row.has_possible_conflict).toBe(0);
	} finally {
		await ctx.db.destroy();
	}
});
