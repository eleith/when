import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb, runMigrations, replaceCalendarBusy, lastCalendarRefreshAt } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { getWorkerContext, setWorkerContext, type WorkerContext } from '../services/context.js';
import { refreshCalendars } from '../calendar/refresh.js';
import { createLogger } from '../services/logger.js';
import { runTestCalendar } from './probe-calendar.js';

const config = {
	providers: {
		'work-dav': {
			type: 'caldav',
			url: 'https://cal.example.com/',
			username: 'u',
			password: 'p',
			calendars: {
				work: { href: 'https://cal.example.com/work/', sync: { refresh_every_minutes: 10 } }
			}
		}
	},
	meetings: {
		chat: { booking_calendar: 'work', additional_busy_calendars: [], booking_window_days: 14 }
	}
} as unknown as WhenConfiguration;

const emptyReport = `<?xml version="1.0"?><multistatus xmlns:C="urn:ietf:params:xml:ns:caldav"></multistatus>`;

let db: WorkerContext['db'];

beforeEach(async () => {
	vi.restoreAllMocks();
	db = openDb(':memory:');
	await runMigrations(db);
	setWorkerContext({
		config,
		logger: createLogger(),
		db,
		mailer: { send: async () => ({ ok: true as const }) }
	});
});

afterEach(async () => {
	await db.destroy();
});

test('an empty calendar test replaces the mirror and supplies fresh evidence only for its calendar', async () => {
	await replaceCalendarBusy(db, 'work', [
		{ start: '2026-04-01T10:00:00Z', end: '2026-04-01T11:00:00Z' }
	]);
	const fetch = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(new Response(emptyReport, { status: 207 }));

	const result = await runTestCalendar({ name: 'work' });
	expect(result).toEqual({ busyCount: 0, days: 14 });
	const mirror = await db.selectFrom('external_calendar_busy').selectAll().execute();
	expect(mirror).toEqual([]);

	const rows = await db.selectFrom('service_status').selectAll().execute();
	expect(rows.map((r) => `${r.kind}/${r.name}`).sort()).toEqual([
		'calendar/work',
		'provider/work-dav'
	]);
	for (const row of rows) {
		expect(row.via).toBe('test');
		const refreshAt = lastCalendarRefreshAt(row);
		expect(refreshAt).toBe(row.kind === 'calendar' ? row.last_ok_at : null);
	}
	const calendar = rows.find((row) => row.kind === 'calendar')!;
	const now = Temporal.Instant.from(calendar.last_ok_at!).add({ minutes: 9 });
	await refreshCalendars(getWorkerContext(), { now });
	expect(fetch).toHaveBeenCalledOnce();
});

test('an unreachable calendar records the failure on both keys and rethrows', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));

	await expect(runTestCalendar({ name: 'work' })).rejects.toThrow();

	const rows = await db.selectFrom('service_status').selectAll().execute();
	expect(rows).toHaveLength(2);
	for (const row of rows) {
		expect(row.error).toBeTruthy();
		expect(row.failing_since).toBeTruthy();
	}
});

test('an unknown calendar throws and records nothing', async () => {
	await expect(runTestCalendar({ name: 'nope' })).rejects.toThrow('No calendar named');
	expect(await db.selectFrom('service_status').selectAll().execute()).toEqual([]);
});
