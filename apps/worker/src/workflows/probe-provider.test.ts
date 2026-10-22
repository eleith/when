import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getProviderAdapter } from '@when/calendar';
import { openDb, runMigrations, listServiceStatus } from '@when/db';
import * as database from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { setWorkerContext, type WorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { runTestProvider, runListProviderCalendars } from './probe-provider.js';

vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return { ...actual, getProviderAdapter: vi.fn() };
});

const config = {
	providers: {
		dav: { type: 'caldav', url: 'https://dav.example.com/', username: 'u', password: 'p' },
		gcal: { type: 'google', client_id: 'cid', client_secret: 'csec', refresh_token: 'cfg-rt' }
	}
} as unknown as WhenConfiguration;

const adapter = {
	calendarIdField: 'path',
	usesOAuth: false,
	verify: vi.fn(),
	listCalendars: vi.fn()
};
let db: WorkerContext['db'];

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
	adapter.verify = vi.fn().mockResolvedValue(undefined);
	adapter.listCalendars = vi.fn().mockResolvedValue([{ id: 'p/1', name: 'Work', primary: false }]);
	vi.mocked(getProviderAdapter).mockReset().mockReturnValue(adapter);
	setWorkerContext({
		config,
		logger: createLogger(),
		db,
		mailer: { send: async () => ({ ok: true as const }) }
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	await db.destroy();
});

test('a passing probe records the provider as working', async () => {
	const result = await runTestProvider({ name: 'dav' });
	expect(result).toBe('authenticated');

	const [status] = await listServiceStatus(db, 'provider');
	expect(status).toMatchObject({ name: 'dav', via: 'test', error: null });
});

test('a failing probe records the reason and still throws', async () => {
	adapter.verify = vi.fn().mockRejectedValue(new Error('bad credentials (401)'));

	await expect(runTestProvider({ name: 'dav' })).rejects.toThrow('401');

	const [status] = await listServiceStatus(db, 'provider');
	expect(status.error).toContain('401');
	expect(status.failing_since).toBeTruthy();
});

test('an unknown provider throws and records nothing', async () => {
	await expect(runTestProvider({ name: 'nope' })).rejects.toThrow('No provider named');
	const statuses = await listServiceStatus(db, 'provider');
	expect(statuses).toEqual([]);
});

test('discovery returns the calendars and counts as an observation', async () => {
	const result = await runListProviderCalendars({ name: 'dav' });

	expect(result).toEqual({
		field: 'path',
		calendars: [{ id: 'p/1', name: 'Work', primary: false }]
	});
	const [status] = await listServiceStatus(db, 'provider');
	expect(status.via).toBe('test');
});

test.each([
	['authentication', runTestProvider],
	['calendar discovery', runListProviderCalendars]
] as const)(
	'successful %s does not report a status-write failure as a provider failure',
	async (_name, run) => {
		const error = new Error('Status write failed');
		const record = vi.spyOn(database, 'recordServiceOutcome').mockRejectedValueOnce(error);

		await expect(run({ name: 'dav' })).rejects.toBe(error);

		expect(getProviderAdapter).toHaveBeenCalledOnce();
		expect(record).toHaveBeenCalledExactlyOnceWith(
			db,
			{ kind: 'provider', name: 'dav' },
			{ at: expect.any(String), via: 'test' }
		);
		const statuses = await listServiceStatus(db, 'provider');
		expect(statuses).toEqual([]);
	}
);

test('failed discovery records the provider failure and preserves the error', async () => {
	const error = new Error('Calendar discovery unavailable');
	adapter.listCalendars.mockRejectedValueOnce(error);

	await expect(runListProviderCalendars({ name: 'dav' })).rejects.toBe(error);

	const [status] = await listServiceStatus(db, 'provider');
	expect(status).toMatchObject({ name: 'dav', via: 'test', error: error.message });
	expect(status.failing_since).toBeTruthy();
});

test('the worker probes with the refresh token when.yaml configured', async () => {
	await runTestProvider({ name: 'gcal' });

	expect(getProviderAdapter).toHaveBeenCalledWith(
		expect.objectContaining({ refresh_token: 'cfg-rt' })
	);
});
