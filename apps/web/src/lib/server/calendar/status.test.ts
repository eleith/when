import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations, recordServiceOutcome, type ServiceStatus } from '@when/db';
import type { ServiceOutcome } from '@when/db';
import { fetchBusyIntervals } from '@when/calendar';
import { getOpenWorkflow } from '@when/jobs';
import type { WhenConfiguration } from '@when/config';
import { validConfig } from '#lib/server/__fixtures__/valid-config.js';
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

const NOW = Temporal.Instant.from('2026-05-01T12:00:00Z');

const config: WhenConfiguration = {
	...validConfig,
	url: { ...validConfig.url, app: 'https://book.example.com', worker: 'http://when-worker:9000' },
	providers: {
		gg: {
			type: 'google',
			client_id: 'cid',
			client_secret: 'csec',
			refresh_token: 'refresh',
			calendars: { work: { id: 'primary', sync: { refresh_every_minutes: 10 } } }
		},
		dav: {
			type: 'caldav',
			url: 'https://dav.example.com',
			username: 'user',
			password: 'secret',
			calendars: { home: { href: 'calendars/u/home/', sync: { refresh_every_minutes: 30 } } }
		}
	},
	meetings: {}
};

let db: ReturnType<typeof openDb>;

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
	vi.spyOn(Temporal.Now, 'instant').mockReturnValue(NOW);
	vi.mocked(fetchBusyIntervals).mockReset().mockResolvedValue([]);

	handle.result = vi.fn().mockResolvedValue({ busyCount: 0, days: 14 });
	client.runWorkflow = vi.fn().mockResolvedValue(handle);
	vi.mocked(getOpenWorkflow)
		.mockReset()
		.mockReturnValue(client as never);
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
});

afterEach(async () => {
	await db.destroy();
	vi.restoreAllMocks();
});

describe('listCalendars', () => {
	test('names the config field each calendar points through', async () => {
		const [work, home] = await listCalendars(config, db);

		expect(work.target).toEqual({ field: 'id', value: 'primary' });
		expect(home.target).toEqual({ field: 'href', value: 'calendars/u/home/' });
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

	test('missing status leaves refresh freshness unknown', async () => {
		const [work] = await listCalendars(config, db);

		expect(work.health).toBe('unknown');
		expect(work.lastSyncedAt).toBeNull();
	});

	test.each(['refresh', 'test'] as const)(
		'successful calendar %s is trusted even with an empty busy mirror',
		async (via) => {
			const at = NOW.subtract({ minutes: 5 }).toString();
			await recordServiceOutcome(db, { kind: 'calendar', name: 'work' }, { at, via });

			const [work] = await listCalendars(config, db);
			const mirror = await db.selectFrom('external_calendar_busy').selectAll().execute();

			expect(mirror).toEqual([]);
			expect(work.health).toBe('good');
			expect(work.lastSyncedAt).toBe(at);
			expect(fetchBusyIntervals).not.toHaveBeenCalled();
		}
	);

	test.each(['refresh', 'test'] as const)(
		'stale successful %s retains its proven refresh time',
		async (via) => {
			const at = NOW.subtract({ minutes: 41 }).toString();
			await recordServiceOutcome(db, { kind: 'calendar', name: 'work' }, { at, via });

			const [work] = await listCalendars(config, db);

			expect(work).toMatchObject({
				health: 'bad',
				reason: `No successful refresh since ${at}.`,
				lastSyncedAt: at
			});
		}
	);

	test.each<{ label: string; outcomes: Omit<ServiceOutcome, 'at'>[]; health: 'unknown' | 'bad' }>([
		{ label: 'successful push', outcomes: [{ via: 'push' }], health: 'unknown' },
		{
			label: 'refresh then push',
			outcomes: [{ via: 'refresh' }, { via: 'push' }],
			health: 'unknown'
		},
		{
			label: 'push then failed refresh',
			outcomes: [{ via: 'push' }, { via: 'refresh', error: 'provider unavailable' }],
			health: 'bad'
		},
		{
			label: 'refresh then failed test',
			outcomes: [{ via: 'refresh' }, { via: 'test', error: 'provider unavailable' }],
			health: 'bad'
		}
	])(
		'$label never presents a general success as a proven refresh',
		async ({ outcomes, health }) => {
			for (const [index, outcome] of outcomes.entries()) {
				await recordServiceOutcome(
					db,
					{ kind: 'calendar', name: 'work' },
					{
						...outcome,
						at: NOW.subtract({ minutes: 120 - index }).toString()
					}
				);
			}

			const [work] = await listCalendars(config, db);

			expect(work.health).toBe(health);
			expect(work.lastSyncedAt).toBeNull();
			expect(work.reason).toBe(health === 'bad' ? 'provider unavailable' : null);
			expect(fetchBusyIntervals).not.toHaveBeenCalled();
		}
	);

	test.each(['authentication', 'discovery'])(
		'provider %s success is not calendar evidence',
		async () => {
			await recordServiceOutcome(
				db,
				{ kind: 'provider', name: 'gg' },
				{ at: NOW.toString(), via: 'test' }
			);

			const [work] = await listCalendars(config, db);

			expect(work).toMatchObject({ health: 'unknown', lastSyncedAt: null, reason: null });
			expect(fetchBusyIntervals).not.toHaveBeenCalled();
		}
	);

	test.each<{ label: string; status: Partial<ServiceStatus> }>([
		{ label: 'missing attempt', status: { last_attempt_at: null } },
		{ label: 'missing success', status: { last_ok_at: null } },
		{ label: 'missing observation', status: { via: null } },
		{ label: 'unknown observation', status: { via: 'other' } },
		{ label: 'malformed success', status: { last_ok_at: 'not-a-date' } },
		{ label: 'malformed attempt', status: { last_attempt_at: 'not-a-date' } },
		{
			label: 'matching malformed dates',
			status: { last_attempt_at: 'not-a-date', last_ok_at: 'not-a-date' }
		},
		{
			label: 'inconsistent timestamps',
			status: { last_attempt_at: NOW.subtract({ minutes: 1 }).toString() }
		},
		{ label: 'inconsistent failure state', status: { failing_since: NOW.toString() } }
	])('$label is unknown rather than healthy or stale', async ({ status }) => {
		await db
			.insertInto('service_status')
			.values({
				kind: 'calendar',
				name: 'work',
				last_attempt_at: NOW.toString(),
				last_ok_at: NOW.toString(),
				via: 'refresh',
				error: null,
				failing_since: null,
				...status
			})
			.execute();

		const [work] = await listCalendars(config, db);

		expect(work).toMatchObject({ health: 'unknown', lastSyncedAt: null, reason: null });
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
			message: 'Worker not reachable.'
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
