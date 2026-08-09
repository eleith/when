import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations, recordServiceOutcome } from '@when/db';
import { getProviderAdapter } from '@when/calendar';
import { getOpenWorkflow, testProvider } from '@when/jobs';
import type { WhenConfiguration } from '@when/config';
import { discoverCalendars, listProviders, probeProvider } from './status';

vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return { ...actual, getProviderAdapter: vi.fn() };
});

vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return { ...actual, getOpenWorkflow: vi.fn() };
});

const handle = { result: vi.fn() };
const client = { runWorkflow: vi.fn() };

// Provider behaviour is the adapter's; these cover what web adds on top.
const adapter = {
	calendarIdField: 'google_calendar_id',
	usesOAuth: true,
	verify: vi.fn(),
	listCalendars: vi.fn()
};

const config = {
	url: { app: 'https://book.example.com', worker: 'http://when-worker:9000' },
	providers: {
		gg: {
			type: 'google',
			client_id: 'cid',
			client_secret: 'csec',
			refresh_token: '',
			calendars: { work: { id: 'primary' } }
		},
		dav: {
			type: 'caldav',
			url: 'https://d.example/',
			username: 'u',
			password: 'p',
			calendars: { home: { href: 'https://d.example/home/' } }
		}
	},
	meetings: {}
} as unknown as WhenConfiguration;

const connectedConfig = {
	...config,
	providers: {
		...config.providers,
		gg: { ...config.providers.gg, refresh_token: 'rt-1' }
	}
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

	handle.result = vi.fn().mockResolvedValue('authenticated');
	client.runWorkflow = vi.fn().mockResolvedValue(handle);
	vi.mocked(getOpenWorkflow)
		.mockReset()
		.mockReturnValue(client as never);
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
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

	test('reads a google service as connected once when.yaml carries a token', async () => {
		const [google] = await listProviders(connectedConfig, db);
		expect(google.connected).toBe(true);
	});

	test('never sends the refresh token to the client', async () => {
		const [google] = await listProviders(connectedConfig, db);
		expect(JSON.stringify(google)).not.toContain('rt-1');
	});

	test('reads a google service with an empty token as not connected', async () => {
		const [google] = await listProviders(config, db);
		expect(google.connected).toBe(false);
	});

	test('never reports a service that keeps its credentials in config as connected', async () => {
		const [, dav] = await listProviders(config, db);
		expect(dav.connected).toBe(false);
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

	test('counts the calendars each provider backs', async () => {
		const [google, dav] = await listProviders(config, db);
		expect(google.calendars).toEqual(['work']);
		expect(dav.calendars).toEqual(['home']);
	});

	test('a provider nothing has touched reads as unobserved, not as broken', async () => {
		const [google] = await listProviders(config, db);
		expect(google.observed.state).toBe('unobserved');
	});

	test('an observed provider reads working', async () => {
		await recordServiceOutcome(
			db,
			{ kind: 'provider', name: 'gg' },
			{ at: Temporal.Now.instant().toString(), via: 'test' }
		);

		const [google] = await listProviders(config, db);

		expect(google.observed.state).toBe('working');
		expect(google.observed.via).toBe('test');
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
});

describe('probeProvider', () => {
	test('names a stopped worker rather than waiting on a run nothing will claim', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

		expect(await probeProvider(config, 'gg')).toEqual({
			ok: false,
			message: 'Worker not reachable.'
		});
		expect(client.runWorkflow).not.toHaveBeenCalled();
	});

	test('runs the probe in the worker and reports success', async () => {
		expect(await probeProvider(config, 'gg')).toEqual({ ok: true, message: 'Authenticated.' });
		expect(client.runWorkflow).toHaveBeenCalledWith(
			testProvider,
			{ name: 'gg' },
			expect.objectContaining({ idempotencyKey: expect.any(String) })
		);
	});

	test('surfaces the provider error the worker raised', async () => {
		handle.result = vi.fn().mockRejectedValue(new Error('invalid_grant'));

		expect(await probeProvider(config, 'gg')).toEqual({ ok: false, message: 'invalid_grant' });
	});
});

describe('discoverCalendars', () => {
	test('returns the calendars and the config field the worker named', async () => {
		handle.result = vi.fn().mockResolvedValue({
			field: 'google_calendar_id',
			calendars: [{ id: 'primary', name: 'Primary calendar', primary: true }]
		});

		expect(await discoverCalendars(config, 'gg')).toEqual({
			ok: true,
			field: 'google_calendar_id',
			calendars: [{ id: 'primary', name: 'Primary calendar', primary: true }]
		});
	});

	test('surfaces a provider failure', async () => {
		handle.result = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));

		expect(await discoverCalendars(config, 'dav')).toEqual({
			ok: false,
			message: '401 Unauthorized'
		});
	});

	test('an empty list is a success, not a failure', async () => {
		handle.result = vi.fn().mockResolvedValue({ field: 'path', calendars: [] });

		expect(await discoverCalendars(config, 'dav')).toEqual({
			ok: true,
			field: 'path',
			calendars: []
		});
	});
});
