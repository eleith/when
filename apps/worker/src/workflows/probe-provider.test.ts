import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getProviderAdapter } from '@when/calendar';
import { openDb, runMigrations, listServiceStatus, saveProviderRefreshToken } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { setWorkerContext, type WorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { runTestProvider, runListProviderCalendars } from './probe-provider.js';

vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return { ...actual, getProviderAdapter: vi.fn() };
});

const config = {
	providers: [
		{ name: 'dav', type: 'caldav', url: 'https://dav.example.com/', username: 'u', password: 'p' },
		{ name: 'gcal', type: 'google', client_id: 'cid', client_secret: 'csec' }
	]
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
	await db.destroy();
});

test('a passing probe records the provider as working', async () => {
	expect(await runTestProvider({ name: 'dav' })).toBe('authenticated');

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
	expect(await listServiceStatus(db, 'provider')).toEqual([]);
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

test('the worker reads the stored refresh token, so no caller has to pass one', async () => {
	await saveProviderRefreshToken(db, 'gcal', 'stored-rt');

	await runTestProvider({ name: 'gcal' });

	expect(getProviderAdapter).toHaveBeenCalledWith(
		expect.objectContaining({ refresh_token: 'stored-rt' })
	);
});
