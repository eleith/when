import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb, runMigrations } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { setWorkerContext, type WorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { runTestCalendar } from './probe-calendar.js';

const config = {
	providers: [
		{
			name: 'work-dav',
			type: 'caldav',
			url: 'https://cal.example.com/',
			username: 'u',
			password: 'p',
			calendars: [{ name: 'work', url: 'https://cal.example.com/work/' }]
		}
	],
	meetings: [
		{
			name: 'chat',
			booking_calendar: 'work',
			additional_busy_calendars: [],
			booking_window_days: 14
		}
	]
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

test('a reachable calendar reports its busy count and records both keys', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(emptyReport, { status: 207 }));

	expect(await runTestCalendar({ name: 'work' })).toEqual({ busyCount: 0, days: 14 });
	const mirror = await db.selectFrom('external_calendar_busy').selectAll().execute();
	expect(mirror).toEqual([]);

	const rows = await db.selectFrom('service_status').selectAll().execute();
	expect(rows.map((r) => `${r.kind}/${r.name}`).sort()).toEqual([
		'calendar/work',
		'provider/work-dav'
	]);
	for (const row of rows) expect(row.via).toBe('test');
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
