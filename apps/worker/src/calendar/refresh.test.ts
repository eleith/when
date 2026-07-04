import { expect, test } from 'vitest';
import pino from 'pino';
import { Temporal } from '@js-temporal/polyfill';
import type { Calendar, WhenConfiguration } from '@when/config';
import type { FetchFn } from '@when/calendar';
import { openDb, runMigrations, replaceCalendarBusy, recordRefreshResult } from '@when/db';
import type { Logger } from '../services/logger.js';
import type { WorkerContext } from '../services/context.js';
import {
	conflictCalendarIds,
	refreshCalendar,
	refreshCalendars,
	refreshWindow
} from './refresh.js';

const inst = (s: string) => Temporal.Instant.from(s);
const window = { start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') };
const silent: Logger = pino({ level: 'silent' });

const workCal: Calendar = {
	id: 'work',
	type: 'caldav',
	service_id: 'work-dav',
	url: 'https://cal.example.com/work/'
};

const oneEvent = (uid: string) => `<?xml version="1.0"?>
<multistatus xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//x//EN
BEGIN:VEVENT
UID:${uid}
DTSTAMP:20260101T000000Z
DTSTART:20260415T140000Z
DTEND:20260415T150000Z
SUMMARY:Remote
END:VEVENT
END:VCALENDAR</C:calendar-data>
  </response>
</multistatus>`;

const defaultTestConfig: WhenConfiguration = {
	services: [
		{
			id: 'work-dav',
			type: 'caldav',
			url: 'https://cal.example.com/work/',
			username: 'jane',
			password: 'secret'
		}
	],
	calendars: [
		workCal
	],
	event_types: [
		{
			id: 'chat',
			name: 'Chat',
			slug: 'chat',
			duration: 30,
			appointment_flow: 'auto',
			destination_calendar: 'work',
			conflict_calendars: ['work']
		}
	],
	user: { name: 'Jane', timezone: 'America/New_York', email: 'jane@example.com' },
	url: { app: 'https://when.example.com' },
	availability: {
		default: {}
	}
} as unknown as WhenConfiguration;

async function ctxWithDb(configOverrides: Partial<WhenConfiguration> = {}): Promise<WorkerContext> {
	const db = openDb(':memory:');
	await runMigrations(db);
	return {
		config: { ...defaultTestConfig, ...configOverrides } as WhenConfiguration,
		logger: silent,
		db,
		mailer: { send: async () => ({ ok: true as const }) }
	};
}

test('refreshCalendar populates the mirror and records success', async () => {
	const ctx = await ctxWithDb();
	try {
		const fetchImpl: FetchFn = async () => new Response(oneEvent('remote-1@x'), { status: 207 });
		await refreshCalendar(ctx, workCal, window, { fetchImpl, now: window.start });
		const busy = await ctx.db.selectFrom('external_calendar_busy').selectAll().execute();
		expect(busy).toHaveLength(1);
		expect(busy[0].start_time).toBe('2026-04-15T14:00:00Z');
		const status = await ctx.db
			.selectFrom('calendar_sync_status')
			.selectAll()
			.where('calendar_id', '=', 'work')
			.executeTakeFirstOrThrow();
		expect(status.last_successful_refresh_at).toBe(window.start.toString());
		expect(status.error).toBeNull();
	} finally {
		await ctx.db.destroy();
	}
});

test('refreshCalendar keeps stale data and records the error on provider failure', async () => {
	const ctx = await ctxWithDb();
	try {
		await replaceCalendarBusy(ctx.db, 'work', [
			{ start: '2026-04-10T09:00:00Z', end: '2026-04-10T09:30:00Z' }
		]);
		const fetchImpl: FetchFn = async () => new Response('boom', { status: 500, statusText: 'err' });
		await refreshCalendar(ctx, workCal, window, { fetchImpl, now: window.start });
		const busy = await ctx.db.selectFrom('external_calendar_busy').selectAll().execute();
		expect(busy).toHaveLength(1);
		expect(busy[0].start_time).toBe('2026-04-10T09:00:00Z');
		const status = await ctx.db
			.selectFrom('calendar_sync_status')
			.selectAll()
			.where('calendar_id', '=', 'work')
			.executeTakeFirstOrThrow();
		expect(status.error).toContain('500');
		expect(status.last_successful_refresh_at).toBeNull();
	} finally {
		await ctx.db.destroy();
	}
});

test('refreshCalendar drops our own published event', async () => {
	const ctx = await ctxWithDb();
	try {
		await ctx.db
			.insertInto('appointments')
			.values({
				id: '1',
				event_type_id: 'chat',
				start_time: '2026-04-15T14:00:00Z',
				end_time: '2026-04-15T15:00:00Z',
				guest_name: 'A',
				guest_email: 'a@example.com',
				location: null,
				status: 'confirmed',
				cancel_token: 't',
				external_event_id: 'remote-1@x',
				external_calendar_id: 'work'
			})
			.execute();
		const fetchImpl: FetchFn = async () => new Response(oneEvent('remote-1@x'), { status: 207 });
		await refreshCalendar(ctx, workCal, window, { fetchImpl, now: window.start });
		const busy = await ctx.db.selectFrom('external_calendar_busy').selectAll().execute();
		expect(busy).toHaveLength(0);
	} finally {
		await ctx.db.destroy();
	}
});

test('conflictCalendarIds unions and dedupes across event types', () => {
	const config = {
		event_types: [{ conflict_calendars: ['a', 'b'] }, { conflict_calendars: ['b', 'c'] }, {}]
	} as unknown as WhenConfiguration;
	expect(conflictCalendarIds(config).sort()).toEqual(['a', 'b', 'c']);
});

test('refreshWindow uses the max lookahead among event types using the calendar', () => {
	const now = inst('2026-04-15T00:00:00Z');
	const config = {
		availability: { maximum_lookahead: 60 },
		event_types: [
			{ conflict_calendars: ['work'], maximum_lookahead: 30 },
			{ conflict_calendars: ['work'], maximum_lookahead: 90 },
			{ conflict_calendars: ['other'], maximum_lookahead: 120 }
		]
	} as unknown as WhenConfiguration;
	const w = refreshWindow(config, 'work', now);
	expect(w.end.toString()).toBe(now.add({ hours: 24 * 90 }).toString());
});

test('refreshWindow falls back to the default lookahead when unset', () => {
	const now = inst('2026-04-15T00:00:00Z');
	const config = {
		availability: {},
		event_types: [{ conflict_calendars: ['work'] }]
	} as unknown as WhenConfiguration;
	const w = refreshWindow(config, 'work', now);
	expect(w.end.toString()).toBe(now.add({ hours: 24 * 60 }).toString());
});

test('refreshCalendars refreshes known conflict calendars and skips unknown ids', async () => {
	const db = openDb(':memory:');
	await runMigrations(db);
	const ctx: WorkerContext = {
		config: {
			availability: {},
			services: defaultTestConfig.services,
			calendars: [workCal],
			event_types: [{ conflict_calendars: ['work', 'ghost'] }]
		} as unknown as WhenConfiguration,
		logger: silent,
		db,
		mailer: { send: async () => ({ ok: true as const }) }
	};
	try {
		const fetchImpl: FetchFn = async () => new Response(oneEvent('r1'), { status: 207 });
		await refreshCalendars(ctx, { fetchImpl, now: window.start });
		const work = await db
			.selectFrom('external_calendar_busy')
			.selectAll()
			.where('calendar_id', '=', 'work')
			.execute();
		expect(work.length).toBeGreaterThan(0);
		const ghost = await db
			.selectFrom('calendar_sync_status')
			.selectAll()
			.where('calendar_id', '=', 'ghost')
			.execute();
		expect(ghost).toHaveLength(0);
	} finally {
		await db.destroy();
	}
});

test('refreshCalendars skips a calendar refreshed within its interval, refreshes once due', async () => {
	const db = openDb(':memory:');
	await runMigrations(db);
	const ctx: WorkerContext = {
		config: {
			availability: {},
			services: defaultTestConfig.services,
			calendars: [{ ...workCal, sync: { refresh_interval: 30 } }],
			event_types: [{ conflict_calendars: ['work'] }]
		} as unknown as WhenConfiguration,
		logger: silent,
		db,
		mailer: { send: async () => ({ ok: true as const }) }
	};
	try {
		await recordRefreshResult(db, 'work', { at: window.start.toString() }); // succeeded just now

		let fetched = false;
		const fetchImpl: FetchFn = async () => {
			fetched = true;
			return new Response(oneEvent('r1'), { status: 207 });
		};

		// 10 min later, interval is 30 → not due, no provider call
		await refreshCalendars(ctx, { fetchImpl, now: window.start.add({ minutes: 10 }) });
		expect(fetched).toBe(false);

		// past the interval → due, refreshes
		await refreshCalendars(ctx, { fetchImpl, now: window.start.add({ minutes: 31 }) });
		expect(fetched).toBe(true);
	} finally {
		await db.destroy();
	}
});
