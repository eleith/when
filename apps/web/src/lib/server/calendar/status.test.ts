import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations, recordServiceOutcome } from '@when/db';
import { fetchBusyIntervals } from '@when/calendar';
import { getOpenWorkflow } from '@when/jobs';
import type { WhenConfiguration } from '@when/config';
import { listCalendars, probeCalendar } from './status';

vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return { ...actual, fetchBusyIntervals: vi.fn() };
});

vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return { ...actual, getOpenWorkflow: vi.fn() };
});

const handle = { result: vi.fn() };
const client = { runWorkflow: vi.fn() };

const config = {
	url: { app: 'https://book.example.com', worker: 'http://when-worker:9000' },
	providers: [{ name: 'gg', type: 'google', client_id: 'cid', client_secret: 'csec' }],
	calendars: [
		{ name: 'work', type: 'google', provider: 'gg', google_calendar_id: 'primary' },
		{
			name: 'home',
			type: 'caldav',
			provider: 'dav',
			path: 'calendars/u/home/',
			sync: { refresh_every_minutes: 30 }
		}
	],
	meetings: []
} as unknown as WhenConfiguration;

let db: ReturnType<typeof openDb>;

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
	vi.mocked(fetchBusyIntervals).mockReset().mockResolvedValue([]);

	handle.result = vi.fn().mockResolvedValue({ busyCount: 0, days: 14 });
	client.runWorkflow = vi.fn().mockResolvedValue(handle);
	vi.mocked(getOpenWorkflow)
		.mockReset()
		.mockReturnValue(client as never);
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
});

describe('listCalendars', () => {
	test('names the config field each calendar points through', async () => {
		const [work, home] = await listCalendars(config, db);

		expect(work.target).toEqual({ label: 'google_calendar_id', value: 'primary' });
		expect(home.target).toEqual({ label: 'path', value: 'calendars/u/home/' });
	});

	test('reaches no provider', async () => {
		await listCalendars(config, db);
		expect(fetchBusyIntervals).not.toHaveBeenCalled();
	});

	test('reports the configured refresh interval, defaulting when unset', async () => {
		const [work, home] = await listCalendars(config, db);

		expect(work.refreshEveryMinutes).toBe(10);
		expect(home.refreshEveryMinutes).toBe(30);
	});

	test('is unknown until the worker has synced', async () => {
		const [work] = await listCalendars(config, db);

		expect(work.health).toBe('unknown');
		expect(work.lastSyncedAt).toBeNull();
	});

	test('reads good health off a successful worker refresh', async () => {
		await recordServiceOutcome(
			db,
			{ kind: 'calendar', name: 'work' },
			{
				at: Temporal.Now.instant().toString(),
				via: 'refresh'
			}
		);

		const [work] = await listCalendars(config, db);

		expect(work.health).toBe('good');
		expect(work.lastSyncedAt).toBeTruthy();
	});

	test('reads bad health, and only for the calendar that failed', async () => {
		const longAgo = Temporal.Now.instant().subtract({ hours: 2 }).toString();
		await recordServiceOutcome(
			db,
			{ kind: 'calendar', name: 'work' },
			{
				at: longAgo,
				via: 'refresh',
				error: 'invalid_grant'
			}
		);

		const [work, home] = await listCalendars(config, db);

		expect(work.health).toBe('bad');
		expect(work.reason).toContain('invalid_grant');
		expect(home.health).toBe('unknown');
	});
});

describe('probeCalendar', () => {
	test('names a stopped worker rather than waiting on a run nothing will claim', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

		expect(await probeCalendar(config, 'work')).toEqual({
			ok: false,
			message: 'The worker is not reachable, so nothing would check it.'
		});
		expect(client.runWorkflow).not.toHaveBeenCalled();
	});

	test('reports how many busy intervals came back', async () => {
		handle.result = vi.fn().mockResolvedValue({ busyCount: 1, days: 14 });

		expect(await probeCalendar(config, 'work')).toEqual({
			ok: true,
			message: '1 busy interval over the next 14 days.'
		});
	});

	test('an empty calendar is reachable, not broken', async () => {
		const result = await probeCalendar(config, 'work');

		expect(result).toMatchObject({ ok: true });
		expect(result.message).toContain('0 busy intervals');
	});

	test('surfaces the failure the worker raised', async () => {
		handle.result = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));

		expect(await probeCalendar(config, 'work')).toEqual({
			ok: false,
			message: '401 Unauthorized'
		});
	});
});
