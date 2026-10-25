import { expect, test, vi, beforeEach } from 'vitest';
import pino from 'pino';
import { sql } from 'kysely';
import type { ResolvedCalendar, WhenConfiguration } from '@when/config';
import { openDb, runMigrations, replaceCalendarBusy, recordServiceOutcome } from '@when/db';
import type { Logger } from '../services/logger.js';
import type { WorkerContext } from '../services/context.js';
import { calendarRefreshTotal } from '../services/metrics.js';
import {
	busyCalendarIds,
	refreshCalendar,
	refreshCalendars,
	refreshCycle,
	refreshWindow
} from './refresh.js';

const inst = (s: string) => Temporal.Instant.from(s);
const window = { start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') };
const silent: Logger = pino({ level: 'silent' });

const workDav = {
	type: 'caldav' as const,
	url: 'https://cal.example.com/work/',
	username: 'jane',
	password: 'secret',
	calendars: {
		work: { href: 'https://cal.example.com/work/', sync: { refresh_every_minutes: 10 } }
	}
};

const workCal: ResolvedCalendar = {
	type: 'caldav',
	name: 'work',
	providerName: 'work-dav',
	provider: workDav,
	calendar: workDav.calendars.work
};

const oneEvent = (uid: string) => `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/work/event.ics</href>
    <propstat><prop><C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//x//EN
BEGIN:VEVENT
UID:${uid}
DTSTAMP:20260101T000000Z
DTSTART:20260415T140000Z
DTEND:20260415T150000Z
SUMMARY:Test event
END:VEVENT
END:VCALENDAR</C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat>
  </response>
</multistatus>`;

const workMeetings = {
	chat: {
		booking_calendar: 'work',
		additional_busy_calendars: [],
		booking_window_days: 60,
		schedule: 'standard'
	}
} as unknown as WhenConfiguration['meetings'];

const appointment = {
	id: '1',
	event_type_id: 'chat',
	start_time: '2026-04-15T14:00:00Z',
	end_time: '2026-04-15T15:00:00Z',
	guest_name: 'A',
	guest_email: 'a@example.com',
	status: 'confirmed' as const,
	cancel_token: 't'
};

const defaultTestConfig = {
	url: { app: 'https://when.example.com' },
	user: { name: 'Jane', email: 'jane@example.com' },
	providers: { 'work-dav': workDav },
	schedules: {
		standard: {
			weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }]
		}
	},
	meetings: {}
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
		const metric = vi.spyOn(calendarRefreshTotal, 'inc');
		const result = await refreshCalendar(ctx, workCal, window, { now: window.start });
		expect(result).toEqual({ ok: true, busyCount: 1 });
		expect(metric).toHaveBeenCalledExactlyOnceWith({
			calendar_id: 'work',
			provider_type: 'caldav',
			status: 'success'
		});
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
		const lastOk = window.start.subtract({ minutes: 30 }).toString();
		await recordServiceOutcome(
			ctx.db,
			{ kind: 'calendar', name: 'work' },
			{ at: lastOk, via: 'refresh' }
		);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('boom', { status: 500, statusText: 'err' })
		);
		const metric = vi.spyOn(calendarRefreshTotal, 'inc');
		const result = await refreshCalendar(ctx, workCal, window, { now: window.start, via: 'test' });
		expect(result).toEqual({ ok: false, error: expect.stringContaining('500') });
		expect(metric).toHaveBeenCalledExactlyOnceWith({
			calendar_id: 'work',
			provider_type: 'caldav',
			status: 'failure'
		});
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
		expect(status.last_ok_at).toBe(lastOk);
		expect(status.via).toBe('test');
	} finally {
		await ctx.db.destroy();
	}
});

test('a partial CalDAV response preserves the mirror; a successful empty report clears it', async () => {
	const ctx = await ctxWithDb();
	const stale = { start: '2026-04-10T09:00:00Z', end: '2026-04-10T09:30:00Z' };
	try {
		await replaceCalendarBusy(ctx.db, 'work', [stale]);
		const partial = oneEvent('remote-1').replace(
			'</multistatus>',
			`<response><href>/work/unavailable.ics</href><propstat>
			<prop><C:calendar-data /></prop><status>HTTP/1.1 404 Not Found</status>
			</propstat></response></multistatus>`
		);
		const fetch = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(partial, { status: 207 }));

		const failed = await refreshCalendar(ctx, workCal, window);
		const retained = await ctx.db
			.selectFrom('external_calendar_busy')
			.select(['start_time', 'end_time'])
			.execute();
		expect(failed).toEqual({ ok: false, error: expect.stringContaining('404') });
		expect(retained).toEqual([{ start_time: stale.start, end_time: stale.end }]);

		fetch.mockResolvedValue(new Response('<d:multistatus xmlns:d="DAV:" />', { status: 207 }));
		const refreshed = await refreshCalendar(ctx, workCal, window);
		const empty = await ctx.db.selectFrom('external_calendar_busy').selectAll().execute();
		const status = await ctx.db
			.selectFrom('service_status')
			.select('error')
			.where('kind', '=', 'calendar')
			.executeTakeFirstOrThrow();
		expect(refreshed).toEqual({ ok: true, busyCount: 0 });
		expect(empty).toEqual([]);
		expect(status.error).toBeNull();
	} finally {
		await ctx.db.destroy();
	}
});

test.each(['HTTP failure', 'invalid event time'])(
	'a later Google page with %s preserves the mirror; a later empty import clears it',
	async (failure) => {
		const provider = {
			type: 'google' as const,
			client_id: 'google-import-client',
			client_secret: 'google-import-secret',
			refresh_token: 'google-import-refresh',
			calendars: { work: { id: 'primary', sync: { refresh_every_minutes: 10 } } }
		};
		const cal: ResolvedCalendar = {
			type: 'google',
			name: 'work',
			providerName: 'google',
			provider,
			calendar: provider.calendars.work
		};
		const ctx = await ctxWithDb({ providers: { google: provider } });
		try {
			const stale = { start: '2026-04-10T09:00:00Z', end: '2026-04-10T09:30:00Z' };
			await replaceCalendarBusy(ctx.db, 'work', [stale]);
			const lastOk = window.start.subtract({ minutes: 30 }).toString();
			await recordServiceOutcome(
				ctx.db,
				{ kind: 'calendar', name: 'work' },
				{ at: lastOk, via: 'refresh' }
			);
			const pages: URL[] = [];
			let empty = false;
			vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
				const url = new URL(String(input));
				if (url.hostname === 'oauth2.googleapis.com') {
					return Response.json({ access_token: 'google-import-token', expires_in: 3600 });
				}
				pages.push(url);
				if (empty) return Response.json({ items: [] });
				if (url.searchParams.has('pageToken')) {
					if (failure === 'HTTP failure') return new Response(null, { status: 503 });
					return Response.json({
						items: [{ id: 'invalid', start: { dateTime: 'invalid' }, end: { dateTime: 'invalid' } }]
					});
				}
				return Response.json({
					nextPageToken: 'more',
					items: [
						{
							id: 'first-page',
							start: { dateTime: '2026-04-15T14:00:00Z' },
							end: { dateTime: '2026-04-15T15:00:00Z' }
						}
					]
				});
			});

			const failed = await refreshCalendar(ctx, cal, window, { now: window.start });

			expect(failed).toMatchObject({ ok: false });
			expect(pages.map((url) => url.searchParams.get('pageToken'))).toEqual([null, 'more']);
			const retained = await ctx.db
				.selectFrom('external_calendar_busy')
				.select(['start_time', 'end_time'])
				.execute();
			expect(retained).toEqual([{ start_time: stale.start, end_time: stale.end }]);
			const failedStatus = await ctx.db
				.selectFrom('service_status')
				.selectAll()
				.where('kind', '=', 'calendar')
				.where('name', '=', 'work')
				.executeTakeFirstOrThrow();
			expect(failedStatus.last_ok_at).toBe(lastOk);
			expect(failedStatus.error).toBeTruthy();

			empty = true;
			const recoveredAt = window.start.add({ minutes: 1 });
			const recovered = await refreshCalendar(ctx, cal, window, { now: recoveredAt });
			const cleared = await ctx.db.selectFrom('external_calendar_busy').selectAll().execute();
			const recoveredStatus = await ctx.db
				.selectFrom('service_status')
				.selectAll()
				.where('kind', '=', 'calendar')
				.where('name', '=', 'work')
				.executeTakeFirstOrThrow();
			expect(recovered).toEqual({ ok: true, busyCount: 0 });
			expect(cleared).toEqual([]);
			expect(recoveredStatus.last_ok_at).toBe(recoveredAt.toString());
			expect(recoveredStatus.error).toBeNull();
		} finally {
			await ctx.db.destroy();
		}
	}
);

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
				...appointment,
				location: null,
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
		meetings: {
			one: { booking_calendar: 'a', additional_busy_calendars: ['b'] },
			two: { booking_calendar: 'a', additional_busy_calendars: ['b', 'c'] },
			three: { booking_calendar: 'a', additional_busy_calendars: [] }
		}
	} as unknown as WhenConfiguration;
	expect(busyCalendarIds(config).sort()).toEqual(['a', 'b', 'c']);
});

test('busyCalendarIds refreshes a booking calendar no meeting lists as busy', () => {
	const config = {
		meetings: { chat: { booking_calendar: 'personal', additional_busy_calendars: [] } }
	} as unknown as WhenConfiguration;
	expect(busyCalendarIds(config)).toEqual(['personal']);
});

test('busyCalendarIds ignores a configured calendar no meeting references', () => {
	const config = {
		providers: { p: { calendars: { personal: {}, unused: {} } } },
		meetings: { chat: { booking_calendar: 'personal', additional_busy_calendars: [] } }
	} as unknown as WhenConfiguration;
	expect(busyCalendarIds(config)).toEqual(['personal']);
});

test('refreshWindow uses the max lookahead among meetings using the calendar', () => {
	const now = inst('2026-04-15T00:00:00Z');
	const config = {
		schedules: { standard: {} },
		meetings: {
			one: {
				booking_calendar: 'primary',
				additional_busy_calendars: ['work'],
				booking_window_days: 30,
				schedule: 'standard'
			},
			two: {
				booking_calendar: 'primary',
				additional_busy_calendars: ['work'],
				booking_window_days: 90,
				schedule: 'standard'
			},
			three: {
				booking_calendar: 'primary',
				additional_busy_calendars: ['other'],
				booking_window_days: 120,
				schedule: 'standard'
			}
		}
	} as unknown as WhenConfiguration;
	const w = refreshWindow(config, 'work', now);
	expect(w.end.toString()).toBe(now.add({ hours: 24 * 90 }).toString());
});

test('refreshWindow uses the default lookahead for a calendar no meeting references', () => {
	const now = inst('2026-04-15T00:00:00Z');
	const config = {
		schedules: { standard: {} },
		meetings: {
			one: {
				booking_calendar: 'primary',
				additional_busy_calendars: ['work'],
				booking_window_days: 30,
				schedule: 'standard'
			}
		}
	} as unknown as WhenConfiguration;
	const w = refreshWindow(config, 'unreferenced', now);
	expect(w.end.toString()).toBe(now.add({ hours: 24 * 60 }).toString());
});

test('refreshCalendars mirrors a booking calendar no meeting lists as busy', async () => {
	const ctx = await ctxWithDb({
		meetings: {
			one: {
				booking_calendar: 'work',
				additional_busy_calendars: [],
				booking_window_days: 60,
				schedule: 'standard'
			}
		}
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
			schedules: { standard: {} },
			providers: defaultTestConfig.providers,
			meetings: {
				one: {
					booking_calendar: 'work',
					additional_busy_calendars: ['ghost'],
					booking_window_days: 60,
					schedule: 'standard'
				}
			}
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

test.each(['push', 'refresh', 'test'] as const)(
	'refreshCalendars refreshes after a latest %s observation that does not prove mirror freshness',
	async (via) => {
		const ctx = await ctxWithDb({ meetings: workMeetings });
		try {
			await recordServiceOutcome(
				ctx.db,
				{ kind: 'calendar', name: 'work' },
				{
					at: window.start.subtract({ minutes: 2 }).toString(),
					via: via === 'push' ? 'refresh' : 'push'
				}
			);
			await recordServiceOutcome(
				ctx.db,
				{ kind: 'calendar', name: 'work' },
				{
					at: window.start.subtract({ minutes: 1 }).toString(),
					via,
					error: via === 'push' ? null : 'offline'
				}
			);
			const fetch = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(oneEvent('new'), { status: 207 }));

			await refreshCalendars(ctx, { now: window.start });

			expect(fetch).toHaveBeenCalledOnce();
			const status = await ctx.db
				.selectFrom('service_status')
				.selectAll()
				.where('kind', '=', 'calendar')
				.where('name', '=', 'work')
				.executeTakeFirstOrThrow();
			expect(status).toMatchObject({
				last_ok_at: window.start.toString(),
				via: 'refresh',
				error: null
			});
		} finally {
			await ctx.db.destroy();
		}
	}
);

test.each([
	{ via: null },
	{ last_ok_at: 'invalid' },
	{ last_attempt_at: 'invalid' },
	{ last_attempt_at: '2026-03-31T23:59:00Z' },
	{ failing_since: '2026-03-31T23:59:00Z' }
])('refreshCalendars treats inconsistent mirror evidence as due: %j', async (overrides) => {
	const ctx = await ctxWithDb({ meetings: workMeetings });
	try {
		await recordServiceOutcome(
			ctx.db,
			{ kind: 'calendar', name: 'work' },
			{ at: window.start.toString(), via: 'refresh' }
		);
		await ctx.db
			.updateTable('service_status')
			.set(overrides)
			.where('kind', '=', 'calendar')
			.where('name', '=', 'work')
			.execute();
		const fetch = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(oneEvent('new'), { status: 207 }));

		await refreshCalendars(ctx, { now: window.start });

		expect(fetch).toHaveBeenCalledOnce();
	} finally {
		await ctx.db.destroy();
	}
});

test('a provider authentication observation cannot postpone calendar refresh', async () => {
	const ctx = await ctxWithDb({ meetings: workMeetings });
	try {
		await recordServiceOutcome(
			ctx.db,
			{ kind: 'provider', name: 'work-dav' },
			{ at: window.start.toString(), via: 'test' }
		);
		const fetch = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(oneEvent('new'), { status: 207 }));

		await refreshCalendars(ctx, { now: window.start });

		expect(fetch).toHaveBeenCalledOnce();
	} finally {
		await ctx.db.destroy();
	}
});

test('refreshCalendars skips a calendar refreshed within its interval, refreshes once due', async () => {
	const db = openDb(':memory:');
	await runMigrations(db);
	const ctx: WorkerContext = {
		config: {
			schedules: { standard: {} },
			providers: {
				'work-dav': {
					...workDav,
					calendars: { work: { ...workDav.calendars.work, sync: { refresh_every_minutes: 30 } } }
				}
			},
			meetings: {
				one: {
					booking_calendar: 'work',
					additional_busy_calendars: [],
					booking_window_days: 60,
					schedule: 'standard'
				}
			}
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

		await refreshCalendars(ctx, { now: window.start.add({ minutes: 30 }) });
		expect(fetched).toBe(true);
	} finally {
		await db.destroy();
	}
});

test('refreshCalendar lets the own-event DB read fail before fetching or recording an outcome', async () => {
	const ctx = await ctxWithDb();
	try {
		await ctx.db.schema.dropTable('appointments').execute();
		const fetch = vi.spyOn(globalThis, 'fetch');
		const log = vi.spyOn(ctx.logger, 'error');
		const metric = vi.spyOn(calendarRefreshTotal, 'inc');

		await expect(refreshCalendar(ctx, workCal, window)).rejects.toThrow('no such table');

		expect(fetch).not.toHaveBeenCalled();
		expect(log).not.toHaveBeenCalled();
		expect(metric).not.toHaveBeenCalled();
		const statuses = await ctx.db.selectFrom('service_status').selectAll().execute();
		expect(statuses).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});

test('refreshCalendar rejects a mirror replacement failure without recording provider failure', async () => {
	const ctx = await ctxWithDb();
	try {
		const stale = { start: '2026-04-10T09:00:00Z', end: '2026-04-10T09:30:00Z' };
		await replaceCalendarBusy(ctx.db, 'work', [stale]);
		await sql`create trigger fail_mirror before insert on external_calendar_busy
			begin select raise(abort, 'mirror unavailable'); end`.execute(ctx.db);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(oneEvent('r1'), { status: 207 }));
		const log = vi.spyOn(ctx.logger, 'error');
		const metric = vi.spyOn(calendarRefreshTotal, 'inc');

		await expect(refreshCalendar(ctx, workCal, window)).rejects.toThrow('mirror unavailable');

		expect(log).not.toHaveBeenCalled();
		expect(metric).not.toHaveBeenCalled();
		const statuses = await ctx.db.selectFrom('service_status').selectAll().execute();
		expect(statuses).toEqual([]);
		const busy = await ctx.db
			.selectFrom('external_calendar_busy')
			.select(['start_time', 'end_time'])
			.execute();
		expect(busy).toEqual([{ start_time: stale.start, end_time: stale.end }]);
	} finally {
		await ctx.db.destroy();
	}
});

test.each(['calendar', 'provider'] as const)(
	'refreshCalendar does not reclassify a successful fetch when the %s status write fails',
	async (kind) => {
		const ctx = await ctxWithDb();
		try {
			await sql`create trigger fail_status before insert on service_status
				when new.kind = ${sql.lit(kind)}
				begin select raise(abort, 'status unavailable'); end`.execute(ctx.db);
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(oneEvent('r1'), { status: 207 })
			);
			const log = vi.spyOn(ctx.logger, 'error');
			const metric = vi.spyOn(calendarRefreshTotal, 'inc');

			await expect(refreshCalendar(ctx, workCal, window)).rejects.toThrow('status unavailable');

			expect(log).not.toHaveBeenCalled();
			expect(metric).not.toHaveBeenCalled();
			const statuses = await ctx.db.selectFrom('service_status').selectAll().execute();
			expect(statuses).toHaveLength(kind === 'provider' ? 1 : 0);
			for (const status of statuses) {
				expect(status.error).toBeNull();
				expect(status.last_ok_at).toBe(window.start.toString());
			}
			const busy = await ctx.db.selectFrom('external_calendar_busy').selectAll().execute();
			expect(busy).toHaveLength(1);
		} finally {
			await ctx.db.destroy();
		}
	}
);

test('refreshCalendar lets a success metric failure escape without recording provider failure', async () => {
	const ctx = await ctxWithDb();
	try {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(oneEvent('r1'), { status: 207 }));
		const error = new Error('metric unavailable');
		const metric = vi.spyOn(calendarRefreshTotal, 'inc').mockImplementationOnce(() => {
			throw error;
		});
		const log = vi.spyOn(ctx.logger, 'error');

		await expect(refreshCalendar(ctx, workCal, window)).rejects.toBe(error);

		expect(log).not.toHaveBeenCalled();
		expect(metric).toHaveBeenCalledTimes(1);
		const statuses = await ctx.db.selectFrom('service_status').selectAll().execute();
		expect(statuses).toHaveLength(2);
		for (const status of statuses) expect(status.error).toBeNull();
	} finally {
		await ctx.db.destroy();
	}
});

test('refreshCalendar rejects if recording an expected provider failure fails locally', async () => {
	const ctx = await ctxWithDb();
	try {
		await sql`create trigger fail_status before insert on service_status
			begin select raise(abort, 'status unavailable'); end`.execute(ctx.db);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
		const metric = vi.spyOn(calendarRefreshTotal, 'inc');

		await expect(refreshCalendar(ctx, workCal, window)).rejects.toThrow('status unavailable');

		expect(metric).not.toHaveBeenCalled();
	} finally {
		await ctx.db.destroy();
	}
});

test('refreshCycle flags conflicts using the newly refreshed mirror', async () => {
	const ctx = await ctxWithDb({ meetings: workMeetings });
	try {
		await ctx.db.insertInto('appointments').values(appointment).execute();
		await replaceCalendarBusy(ctx.db, 'work', [
			{ start: '2026-04-10T09:00:00Z', end: '2026-04-10T09:30:00Z' }
		]);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(oneEvent('r1'), { status: 207 }));

		await refreshCycle(ctx, { now: window.start });

		const row = await ctx.db
			.selectFrom('appointments')
			.select('has_possible_conflict')
			.executeTakeFirstOrThrow();
		expect(row.has_possible_conflict).toBe(1);
		const statuses = await ctx.db.selectFrom('service_status').selectAll().execute();
		expect(statuses).toHaveLength(2);
		for (const status of statuses) {
			expect(status.last_attempt_at).toBe(window.start.toString());
			expect(status.error).toBeNull();
		}
	} finally {
		await ctx.db.destroy();
	}
});

test('refreshCycle flags conflicts using the stale mirror after a provider failure', async () => {
	const ctx = await ctxWithDb({ meetings: workMeetings });
	try {
		await ctx.db.insertInto('appointments').values(appointment).execute();
		await replaceCalendarBusy(ctx.db, 'work', [
			{ start: appointment.start_time, end: appointment.end_time }
		]);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));

		await refreshCycle(ctx, { now: window.start });

		const row = await ctx.db
			.selectFrom('appointments')
			.select('has_possible_conflict')
			.executeTakeFirstOrThrow();
		expect(row.has_possible_conflict).toBe(1);
		const statuses = await ctx.db.selectFrom('service_status').selectAll().execute();
		expect(statuses).toHaveLength(2);
		for (const status of statuses) {
			expect(status.last_attempt_at).toBe(window.start.toString());
			expect(status.error).toEqual(expect.stringContaining('500'));
		}
	} finally {
		await ctx.db.destroy();
	}
});

test('refreshCycle lets conflict writes fail without marking a successful provider refresh as failed', async () => {
	const ctx = await ctxWithDb({ meetings: workMeetings });
	try {
		await ctx.db.insertInto('appointments').values(appointment).execute();
		await sql`create trigger fail_conflict before update of has_possible_conflict on appointments
			begin select raise(abort, 'conflict unavailable'); end`.execute(ctx.db);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(oneEvent('r1'), { status: 207 }));
		const log = vi.spyOn(ctx.logger, 'error');
		const metric = vi.spyOn(calendarRefreshTotal, 'inc');

		await expect(refreshCycle(ctx, { now: window.start })).rejects.toThrow('conflict unavailable');

		expect(log).not.toHaveBeenCalled();
		expect(metric).toHaveBeenCalledExactlyOnceWith({
			calendar_id: 'work',
			provider_type: 'caldav',
			status: 'success'
		});
		const statuses = await ctx.db.selectFrom('service_status').selectAll().execute();
		expect(statuses).toHaveLength(2);
		for (const status of statuses) {
			expect(status.error).toBeNull();
			expect(status.last_ok_at).toBe(window.start.toString());
		}
	} finally {
		await ctx.db.destroy();
	}
});

test('refreshCalendars keeps independent due intervals and retries a stale failure on later passes', async () => {
	const ctx = await ctxWithDb({
		providers: {
			'work-dav': {
				...workDav,
				calendars: {
					...workDav.calendars,
					other: { href: 'https://cal.example.com/other/', sync: { refresh_every_minutes: 30 } }
				}
			}
		},
		meetings: {
			chat: { ...workMeetings.chat, additional_busy_calendars: ['other'] }
		}
	});
	try {
		for (const name of ['work', 'other']) {
			await recordServiceOutcome(
				ctx.db,
				{ kind: 'calendar', name },
				{ at: window.start.toString(), via: 'refresh' }
			);
		}
		const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			return new Response('boom', { status: 500 });
		});

		await refreshCalendars(ctx, { now: window.start.add({ minutes: 9 }) });
		expect(fetch).not.toHaveBeenCalled();
		await refreshCalendars(ctx, { now: window.start.add({ minutes: 10 }) });
		await refreshCalendars(ctx, { now: window.start.add({ minutes: 11 }) });
		expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
			'https://cal.example.com/work/',
			'https://cal.example.com/work/'
		]);

		await refreshCalendars(ctx, { now: window.start.add({ minutes: 30 }) });
		expect(fetch.mock.calls.slice(2).map(([url]) => String(url))).toEqual([
			'https://cal.example.com/work/',
			'https://cal.example.com/other/'
		]);
	} finally {
		await ctx.db.destroy();
	}
});

test('refreshCalendars uses a reloaded calendar interval on its next pass', async () => {
	const ctx = await ctxWithDb({ meetings: workMeetings });
	try {
		await recordServiceOutcome(
			ctx.db,
			{ kind: 'calendar', name: 'work' },
			{ at: window.start.toString(), via: 'refresh' }
		);
		const fetch = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(oneEvent('r1'), { status: 207 }));
		const now = window.start.add({ minutes: 5 });
		await refreshCalendars(ctx, { now });
		expect(fetch).not.toHaveBeenCalled();

		ctx.config = {
			...ctx.config,
			providers: {
				'work-dav': {
					...workDav,
					calendars: { work: { ...workDav.calendars.work, sync: { refresh_every_minutes: 5 } } }
				}
			}
		};
		await refreshCalendars(ctx, { now });
		expect(fetch).toHaveBeenCalledTimes(1);
	} finally {
		await ctx.db.destroy();
	}
});
