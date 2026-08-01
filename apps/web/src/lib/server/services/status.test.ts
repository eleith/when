import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations, saveServiceRefreshToken, recordRefreshResult } from '@when/db';
import { getProviderAdapter } from '@when/calendar';
import type { WhenConfiguration } from '@when/config';
import { discoverCalendars, listServices, probeService } from './status';

vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return { ...actual, getProviderAdapter: vi.fn() };
});

// Provider behaviour is the adapter's; these tests cover what web adds — joining the
// stored token, mapping failures, and never reaching a provider on load.
const adapter = {
	calendarIdField: 'google_calendar_id',
	usesOAuth: true,
	verify: vi.fn(),
	listCalendars: vi.fn()
};

const config = {
	url: { app: 'https://book.example.com' },
	providers: [
		{ name: 'gg', type: 'google', client_id: 'cid', client_secret: 'csec' },
		{ name: 'dav', type: 'caldav', url: 'https://d.example/', username: 'u', password: 'p' }
	],
	calendars: [
		{ name: 'work', type: 'google', provider: 'gg', google_calendar_id: 'primary' },
		{ name: 'home', type: 'caldav', provider: 'dav', url: 'https://d.example/home/' }
	],
	meetings: []
} as unknown as WhenConfiguration;

let db: ReturnType<typeof openDb>;

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
	adapter.verify = vi.fn().mockResolvedValue(undefined);
	adapter.listCalendars = vi.fn().mockResolvedValue([]);
	vi.mocked(getProviderAdapter)
		.mockReset()
		.mockImplementation((service) => ({
			...adapter,
			usesOAuth: service.type === 'google',
			calendarIdField: service.type === 'google' ? 'google_calendar_id' : 'path'
		}));
});

describe('listServices', () => {
	test('lists every service type, not just google', async () => {
		const views = await listServices(config, db);
		expect(views.map((v) => v.name)).toEqual(['gg', 'dav']);
		expect(views.map((v) => v.type)).toEqual(['google', 'caldav']);
	});

	test('reaches no provider', async () => {
		await listServices(config, db);
		expect(adapter.verify).not.toHaveBeenCalled();
		expect(adapter.listCalendars).not.toHaveBeenCalled();
	});

	test('carries connection state for a connected google service', async () => {
		await saveServiceRefreshToken(db, 'gg', 'rt-1');
		const [google] = await listServices(config, db);
		expect(google.connectedAt).toBeTruthy();
		expect(JSON.stringify(google)).not.toContain('rt-1');
	});

	test('leaves connection state null for services that never store one', async () => {
		const [, dav] = await listServices(config, db);
		expect(dav.connectedAt).toBeNull();
	});

	test('shows the redirect URI to register for google', async () => {
		const [google] = await listServices(config, db);
		expect(google.endpoint).toEqual({
			label: 'Redirect URI',
			url: 'https://book.example.com/admin/services/google/callback'
		});
	});

	test('shows the configured server url for caldav', async () => {
		const [, dav] = await listServices(config, db);
		expect(dav.endpoint).toEqual({ label: 'Server URL', url: 'https://d.example/' });
	});

	test('lists the calendars each service backs', async () => {
		const [google, dav] = await listServices(config, db);
		expect(google.calendars).toEqual(['work']);
		expect(dav.calendars).toEqual(['home']);
	});

	test('health is unknown until the worker has synced', async () => {
		const [google] = await listServices(config, db);
		expect(google.health).toBe('unknown');
		expect(google.lastSyncedAt).toBeNull();
	});

	test('a successful worker refresh makes the service read as syncing', async () => {
		await recordRefreshResult(db, 'work', { at: Temporal.Now.instant().toString() });

		const [google] = await listServices(config, db);

		expect(google.health).toBe('good');
		expect(google.lastSyncedAt).toBeTruthy();
	});

	test('a failed worker refresh surfaces on the service that owns the calendar', async () => {
		const longAgo = Temporal.Now.instant().subtract({ hours: 2 }).toString();
		await recordRefreshResult(db, 'work', { at: longAgo, error: 'invalid_grant' });

		const [google, dav] = await listServices(config, db);

		expect(google.health).toBe('bad');
		expect(google.reason).toContain('invalid_grant');
		expect(dav.health).toBe('unknown');
	});
});

describe('probeService', () => {
	test('hands the adapter the stored token', async () => {
		await saveServiceRefreshToken(db, 'gg', 'rt-1');

		expect(await probeService(config, db, 'gg')).toEqual({ ok: true, message: 'Authenticated.' });
		expect(getProviderAdapter).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'gg', refresh_token: 'rt-1' })
		);
	});

	test('hands the adapter a null token when nothing is stored', async () => {
		await probeService(config, db, 'gg');

		expect(getProviderAdapter).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'gg', refresh_token: null })
		);
	});

	test('surfaces the provider error verbatim', async () => {
		adapter.verify = vi.fn().mockRejectedValue(new Error('invalid_grant'));

		expect(await probeService(config, db, 'gg')).toEqual({ ok: false, message: 'invalid_grant' });
	});

	test('reports an unknown service', async () => {
		expect(await probeService(config, db, 'nope')).toEqual({
			ok: false,
			message: 'No service named "nope".'
		});
	});
});

describe('discoverCalendars', () => {
	test('returns the calendars and the config field the adapter names', async () => {
		adapter.listCalendars = vi
			.fn()
			.mockResolvedValue([{ id: 'primary', name: 'Primary calendar', primary: true }]);

		expect(await discoverCalendars(config, db, 'gg')).toEqual({
			ok: true,
			field: 'google_calendar_id',
			calendars: [{ id: 'primary', name: 'Primary calendar', primary: true }]
		});
	});

	test('surfaces a provider failure', async () => {
		adapter.listCalendars = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));

		expect(await discoverCalendars(config, db, 'dav')).toEqual({
			ok: false,
			message: '401 Unauthorized'
		});
	});

	test('reports an unknown service', async () => {
		expect(await discoverCalendars(config, db, 'nope')).toEqual({
			ok: false,
			message: 'No service named "nope".'
		});
	});

	test('an empty list is a success, not a failure', async () => {
		expect(await discoverCalendars(config, db, 'dav')).toEqual({
			ok: true,
			field: 'path',
			calendars: []
		});
	});
});
