import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
	openDb,
	runMigrations,
	saveProviderRefreshToken,
	recordServiceOutcome,
	listServiceStatus
} from '@when/db';
import { getProviderAdapter } from '@when/calendar';
import type { WhenConfiguration } from '@when/config';
import { discoverCalendars, listProviders, probeProvider } from './status';

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

describe('listProviders', () => {
	test('lists every service type, not just google', async () => {
		const views = await listProviders(config, db);
		expect(views.map((v) => v.name)).toEqual(['gg', 'dav']);
		expect(views.map((v) => v.type)).toEqual(['google', 'caldav']);
	});

	test('reaches no provider', async () => {
		await listProviders(config, db);
		expect(adapter.verify).not.toHaveBeenCalled();
		expect(adapter.listCalendars).not.toHaveBeenCalled();
	});

	test('carries connection state for a connected google service', async () => {
		await saveProviderRefreshToken(db, 'gg', 'rt-1');
		const [google] = await listProviders(config, db);
		expect(google.connectedAt).toBeTruthy();
		expect(JSON.stringify(google)).not.toContain('rt-1');
	});

	test('leaves connection state null for services that never store one', async () => {
		const [, dav] = await listProviders(config, db);
		expect(dav.connectedAt).toBeNull();
	});

	test('shows the redirect URI to register for google', async () => {
		const [google] = await listProviders(config, db);
		expect(google.endpoint).toEqual({
			label: 'Redirect URI',
			url: 'https://book.example.com/admin/services/google/callback'
		});
	});

	test('shows the configured server url for caldav', async () => {
		const [, dav] = await listProviders(config, db);
		expect(dav.endpoint).toEqual({ label: 'Server URL', url: 'https://d.example/' });
	});

	test('lists the calendars each service backs', async () => {
		const [google, dav] = await listProviders(config, db);
		expect(google.calendars).toEqual(['work']);
		expect(dav.calendars).toEqual(['home']);
	});

	test('a provider nothing has touched reads as unobserved, not as broken', async () => {
		const [google] = await listProviders(config, db);
		expect(google.observed.state).toBe('unobserved');
		expect(google.sync.health).toBe('unknown');
		expect(google.sync.lastSyncedAt).toBeNull();
	});

	test('an observed provider reads working, whatever its calendars are doing', async () => {
		await recordServiceOutcome(
			db,
			{ kind: 'provider', name: 'gg' },
			{ at: Temporal.Now.instant().toString(), via: 'test' }
		);

		const [google] = await listProviders(config, db);

		expect(google.observed.state).toBe('working');
		expect(google.observed.via).toBe('test');
		expect(google.sync.health).toBe('unknown');
	});

	test('a failing provider reports the error and when the streak began', async () => {
		const longAgo = Temporal.Now.instant().subtract({ hours: 2 }).toString();
		await recordServiceOutcome(
			db,
			{ kind: 'provider', name: 'gg' },
			{ at: longAgo, via: 'refresh', error: 'invalid_grant' }
		);

		const [google] = await listProviders(config, db);

		expect(google.observed.state).toBe('failing');
		expect(google.observed.error).toBe('invalid_grant');
		expect(google.observed.at).toBe(longAgo);
	});

	test('a successful worker refresh makes the service read as syncing', async () => {
		await recordServiceOutcome(
			db,
			{ kind: 'calendar', name: 'work' },
			{
				at: Temporal.Now.instant().toString(),
				via: 'refresh'
			}
		);

		const [google] = await listProviders(config, db);

		expect(google.sync.health).toBe('good');
		expect(google.sync.lastSyncedAt).toBeTruthy();
	});

	test('a failed worker refresh surfaces on the service that owns the calendar', async () => {
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

		const [google, dav] = await listProviders(config, db);

		expect(google.sync.health).toBe('bad');
		expect(google.sync.reason).toContain('invalid_grant');
		expect(dav.sync.health).toBe('unknown');
	});
});

describe('probeProvider', () => {
	test('a passing probe is recorded like any other observation', async () => {
		await saveProviderRefreshToken(db, 'gg', 'rt-1');
		await probeProvider(config, db, 'gg');

		const [google] = await listProviders(config, db);
		expect(google.observed.state).toBe('working');
		expect(google.observed.via).toBe('test');
	});

	test('a failing probe records the reason it failed', async () => {
		adapter.verify = vi.fn().mockRejectedValue(new Error('bad credentials (401)'));
		await probeProvider(config, db, 'gg');

		const [google] = await listProviders(config, db);
		expect(google.observed.state).toBe('failing');
		expect(google.observed.error).toContain('401');
	});

	test('probing a provider that is not configured records nothing', async () => {
		await probeProvider(config, db, 'nope');
		expect(await listServiceStatus(db, 'provider')).toEqual([]);
	});

	test('hands the adapter the stored token', async () => {
		await saveProviderRefreshToken(db, 'gg', 'rt-1');

		expect(await probeProvider(config, db, 'gg')).toEqual({ ok: true, message: 'Authenticated.' });
		expect(getProviderAdapter).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'gg', refresh_token: 'rt-1' })
		);
	});

	test('hands the adapter a null token when nothing is stored', async () => {
		await probeProvider(config, db, 'gg');

		expect(getProviderAdapter).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'gg', refresh_token: null })
		);
	});

	test('surfaces the provider error verbatim', async () => {
		adapter.verify = vi.fn().mockRejectedValue(new Error('invalid_grant'));

		expect(await probeProvider(config, db, 'gg')).toEqual({ ok: false, message: 'invalid_grant' });
	});

	test('reports an unknown provider', async () => {
		expect(await probeProvider(config, db, 'nope')).toEqual({
			ok: false,
			message: 'No provider named "nope".'
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

	test('reports an unknown provider', async () => {
		expect(await discoverCalendars(config, db, 'nope')).toEqual({
			ok: false,
			message: 'No provider named "nope".'
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
