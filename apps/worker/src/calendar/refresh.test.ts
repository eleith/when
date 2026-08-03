import { expect, test, vi, beforeEach } from 'vitest';
import pino from 'pino';
import type { ResolvedCalendar, WhenConfiguration } from '@when/config';
import { openDb, runMigrations, replaceCalendarBusy, recordServiceOutcome } from '@when/db';
import type { Logger } from '../services/logger.js';
import type { WorkerContext } from '../services/context.js';
import { busyCalendarIds, refreshCalendar, refreshCalendars, refreshWindow } from './refresh.js';

const inst = (s: string) => Temporal.Instant.from(s);
const window = { start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') };
const silent: Logger = pino({ level: 'silent' });

const workDav = {
	name: 'work-dav',
	type: 'caldav' as const,
	url: 'https://cal.example.com/work/',
	username: 'jane',
	password: 'secret',
	calendars: [
		{ name: 'work', url: 'https://cal.example.com/work/', sync: { refresh_every_minutes: 10 } }
	]
};

const workCal: ResolvedCalendar = {
	type: 'caldav',
	provider: workDav,
	calendar: workDav.calendars[0]
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
SUMMARY:Test event
END:VEVENT
END:VCALENDAR</C:calendar-data>
  </response>
</multistatus>`;

const defaultTestConfig = {
	url: { app: 'https://when.example.com' },
	user: { name: 'Jane', email: 'jane@example.com' },
	providers: [workDav],
	schedules: [
		{
			name: 'standard',
			weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }]
		}
	],
	meetings: []
};

async function ctxWithDb(configOverrides: Partial<WhenConfiguration> = {}): Promise<WorkerContext> {
	const db = openDb(':memory:');
	await runMigrations(db);
	return {
		config: { ...defaultTestConfig, ...configOverrides } as unknown as WhenConfiguration,
		logger: silent,
		db,
		mailer: { send: async () => ({ ok: true as const }) }
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
});

test('refreshCalendar populates the mirror and records success', async () => {
	const ctx = await ctxWithDb();
	try {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(oneEvent('remote-1@x'), { status: 207 })
		);
		await refreshCalendar(ctx, workCal, window, { now: window.start });
		const busy = await ctx.db.selectFrom('external_calendar_busy').selectAll().execute();
		expect(busy).toHaveLength(1);
		expect(busy[0].start_time).toBe('2026-04-15T14:00:00Z');
		const status = await ctx.db
			.selectFrom('service_status')
			.selectAll()
			.where('kind', '=', 'calendar')
			.where('name', '=', 'work')
			.executeTakeFirstOrThrow();
		expect(status.last_ok_at).toBe(window.start.toString());
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
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('boom', { status: 500, statusText: 'err' })
		);
		await refreshCalendar(ctx, workCal, window, { now: window.start });
		const busy = await ctx.db.selectFrom('external_calendar_busy').selectAll().execute();
		expect(busy).toHaveLength(1);
		expect(busy[0].start_time).toBe('2026-04-10T09:00:00Z');
		const status = await ctx.db
			.selectFrom('service_status')
			.selectAll()
			.where('kind', '=', 'calendar')
			.where('name', '=', 'work')
			.executeTakeFirstOrThrow();
		expect(status.error).toContain('500');
		expect(status.last_ok_at).toBeNull();
	} finally {
		await ctx.db.destroy();
	}
});

test('a successful refresh records the provider behind the calendar', async () => {
	const ctx = await ctxWithDb();
	try {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(oneEvent('remote-1@x'), { status: 207 })
		);
		await refreshCalendar(ctx, workCal, window, { now: window.start });

		const provider = await ctx.db
			.selectFrom('service_status')
			.selectAll()
			.where('kind', '=', 'provider')
			.where('name', '=', 'work-dav')
			.executeTakeFirstOrThrow();
		expect(provider.last_ok_at).toBe(window.start.toString());
		expect(provider.via).toBe('refresh');
	} finally {
		await ctx.db.destroy();
	}
});

test('a provider failure marks both the calendar and the provider', async () => {
	const ctx = await ctxWithDb();
	try {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('boom', { status: 500, statusText: 'err' })
		);
		await refreshCalendar(ctx, workCal, window, { now: window.start });

		const rows = await ctx.db.selectFrom('service_status').selectAll().execute();
		expect(rows.map((r) => `${r.kind}/${r.name}`).sort()).toEqual([
			'calendar/work',
			'provider/work-dav'
		]);
		for (const row of rows) {
			expect(row.error).toContain('500');
			expect(row.failing_since).toBe(window.start.toString());
		}
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
				external_calendar_id: 'work',
				calendar_revision: 0,
				ics_sequence: 0,
				has_possible_conflict: 0,
				meeting_snapshot: null
			})
			.execute();
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(oneEvent('remote-1@x'), { status: 207 })
		);
		await refreshCalendar(ctx, workCal, window, { now: window.start });
		const busy = await ctx.db.selectFrom('external_calendar_busy').selectAll().execute();
		expect(busy).toHaveLength(0);
	} finally {
		await ctx.db.destroy();
	}
});

test('busyCalendarIds unions and dedupes across meetings', () => {
	const config = {
		meetings: [
			{ booking_calendar: 'a', additional_busy_calendars: ['b'] },
			{ booking_calendar: 'a', additional_busy_calendars: ['b', 'c'] },
			{ booking_calendar: 'a', additional_busy_calendars: [] }
		]
	} as unknown as WhenConfiguration;
	expect(busyCalendarIds(config).sort()).toEqual(['a', 'b', 'c']);
});

test('busyCalendarIds refreshes a booking calendar no meeting lists as busy', () => {
	const config = {
		meetings: [{ booking_calendar: 'personal', additional_busy_calendars: [] }]
	} as unknown as WhenConfiguration;
	expect(busyCalendarIds(config)).toEqual(['personal']);
});

test('busyCalendarIds ignores a configured calendar no meeting references', () => {
	const config = {
		calendars: [{ name: 'personal' }, { name: 'unused' }],
		meetings: [{ booking_calendar: 'personal', additional_busy_calendars: [] }]
	} as unknown as WhenConfiguration;
	expect(busyCalendarIds(config)).toEqual(['personal']);
});

test('refreshWindow uses the max lookahead among meetings using the calendar', () => {
	const now = inst('2026-04-15T00:00:00Z');
	const config = {
		schedules: [{ name: 'standard' }],
		meetings: [
			{
				booking_calendar: 'primary',
				additional_busy_calendars: ['work'],
				booking_window_days: 30,
				schedule: 'standard'
			},
			{
				booking_calendar: 'primary',
				additional_busy_calendars: ['work'],
				booking_window_days: 90,
				schedule: 'standard'
			},
			{
				booking_calendar: 'primary',
				additional_busy_calendars: ['other'],
				booking_window_days: 120,
				schedule: 'standard'
			}
		]
	} as unknown as WhenConfiguration;
	const w = refreshWindow(config, 'work', now);
	expect(w.end.toString()).toBe(now.add({ hours: 24 * 90 }).toString());
});

test('refreshWindow uses the default lookahead for a calendar no meeting references', () => {
	const now = inst('2026-04-15T00:00:00Z');
	const config = {
		schedules: [{ name: 'standard' }],
		meetings: [
			{
				booking_calendar: 'primary',
				additional_busy_calendars: ['work'],
				booking_window_days: 30,
				schedule: 'standard'
			}
		]
	} as unknown as WhenConfiguration;
	const w = refreshWindow(config, 'unreferenced', now);
	expect(w.end.toString()).toBe(now.add({ hours: 24 * 60 }).toString());
});

test('refreshCalendars mirrors a booking calendar no meeting lists as busy', async () => {
	const ctx = await ctxWithDb({
		meetings: [
			{
				booking_calendar: 'work',
				additional_busy_calendars: [],
				booking_window_days: 60,
				schedule: 'standard'
			}
		]
	} as unknown as Partial<WhenConfiguration>);
	try {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(oneEvent('r1'), { status: 207 }));
		await refreshCalendars(ctx, { now: window.start });
		const busy = await ctx.db
			.selectFrom('external_calendar_busy')
			.selectAll()
			.where('calendar_id', '=', 'work')
			.execute();
		expect(busy.length).toBeGreaterThan(0);
	} finally {
		await ctx.db.destroy();
	}
});

test('refreshCalendars refreshes known busy calendars and skips unknown ids', async () => {
	const db = openDb(':memory:');
	await runMigrations(db);
	const ctx: WorkerContext = {
		config: {
			schedules: [{ name: 'standard' }],
			providers: defaultTestConfig.providers,
			meetings: [
				{
					booking_calendar: 'work',
					additional_busy_calendars: ['ghost'],
					booking_window_days: 60,
					schedule: 'standard'
				}
			]
		} as unknown as WhenConfiguration,
		logger: silent,
		db,
		mailer: { send: async () => ({ ok: true as const }) }
	};
	try {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(oneEvent('r1'), { status: 207 }));
		await refreshCalendars(ctx, { now: window.start });
		const work = await db
			.selectFrom('external_calendar_busy')
			.selectAll()
			.where('calendar_id', '=', 'work')
			.execute();
		expect(work.length).toBeGreaterThan(0);
		const ghost = await db
			.selectFrom('service_status')
			.selectAll()
			.where('kind', '=', 'calendar')
			.where('name', '=', 'ghost')
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
			schedules: [{ name: 'standard' }],
			providers: [
				{
					...workDav,
					calendars: [{ ...workDav.calendars[0], sync: { refresh_every_minutes: 30 } }]
				}
			],
			meetings: [
				{
					booking_calendar: 'work',
					additional_busy_calendars: [],
					booking_window_days: 60,
					schedule: 'standard'
				}
			]
		} as unknown as WhenConfiguration,
		logger: silent,
		db,
		mailer: { send: async () => ({ ok: true as const }) }
	};
	try {
		await recordServiceOutcome(
			db,
			{ kind: 'calendar', name: 'work' },
			{
				at: window.start.toString(),
				via: 'refresh'
			}
		); // succeeded just now

		let fetched = false;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			fetched = true;
			return new Response(oneEvent('r1'), { status: 207 });
		});

		// 10 min later, interval is 30 → not due, no provider call
		await refreshCalendars(ctx, { now: window.start.add({ minutes: 10 }) });
		expect(fetched).toBe(false);

		// past the interval → due, refreshes
		await refreshCalendars(ctx, { now: window.start.add({ minutes: 31 }) });
		expect(fetched).toBe(true);
	} finally {
		await db.destroy();
	}
});
