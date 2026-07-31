import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations, saveServiceRefreshToken, recordRefreshResult } from '@when/db';
import { getGoogleAccessToken, verifyCalDavService } from '@when/calendar';
import type { WhenConfiguration } from '@when/config';
import { listServices, probeService } from './status';

vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return {
		...actual,
		getGoogleAccessToken: vi.fn(),
		verifyCalDavService: vi.fn()
	};
});

const config = {
	url: { app: 'https://book.example.com' },
	services: [
		{ name: 'gg', type: 'google', client_id: 'cid', client_secret: 'csec' },
		{ name: 'dav', type: 'caldav', url: 'https://d.example/', username: 'u', password: 'p' }
	],
	calendars: [
		{ name: 'work', type: 'google', service: 'gg', google_calendar_id: 'primary' },
		{ name: 'home', type: 'caldav', service: 'dav', url: 'https://d.example/home/' }
	],
	meetings: []
} as unknown as WhenConfiguration;

let db: ReturnType<typeof openDb>;

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
	vi.mocked(getGoogleAccessToken).mockReset().mockResolvedValue('access');
	vi.mocked(verifyCalDavService).mockReset().mockResolvedValue(undefined);
});

describe('listServices', () => {
	test('lists every service type, not just google', async () => {
		const views = await listServices(config, db);
		expect(views.map((v) => v.name)).toEqual(['gg', 'dav']);
		expect(views.map((v) => v.type)).toEqual(['google', 'caldav']);
	});

	test('reaches no provider', async () => {
		await listServices(config, db);
		expect(getGoogleAccessToken).not.toHaveBeenCalled();
		expect(verifyCalDavService).not.toHaveBeenCalled();
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
	test('authenticates a connected google service with its stored token', async () => {
		await saveServiceRefreshToken(db, 'gg', 'rt-1');

		const result = await probeService(config, db, 'gg');

		expect(result).toEqual({ ok: true, message: 'Authenticated.' });
		expect(getGoogleAccessToken).toHaveBeenCalledWith(
			expect.objectContaining({ refresh_token: 'rt-1' })
		);
	});

	test('reports an unconnected google service without calling google', async () => {
		const result = await probeService(config, db, 'gg');

		expect(result).toEqual({ ok: false, message: 'Not connected yet.' });
		expect(getGoogleAccessToken).not.toHaveBeenCalled();
	});

	test('surfaces the provider error verbatim', async () => {
		await saveServiceRefreshToken(db, 'gg', 'rt-1');
		vi.mocked(getGoogleAccessToken).mockRejectedValue(new Error('invalid_grant'));

		expect(await probeService(config, db, 'gg')).toEqual({ ok: false, message: 'invalid_grant' });
	});

	test('verifies a caldav service against its configured credentials', async () => {
		const result = await probeService(config, db, 'dav');

		expect(result.ok).toBe(true);
		expect(verifyCalDavService).toHaveBeenCalledWith(
			expect.objectContaining({ url: 'https://d.example/' })
		);
	});

	test('reports a caldav failure', async () => {
		vi.mocked(verifyCalDavService).mockRejectedValue(new Error('401 Unauthorized'));

		expect(await probeService(config, db, 'dav')).toEqual({
			ok: false,
			message: '401 Unauthorized'
		});
	});

	test('reports an unknown service', async () => {
		expect(await probeService(config, db, 'nope')).toEqual({
			ok: false,
			message: 'No service named "nope".'
		});
	});
});
