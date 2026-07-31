import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getServiceAdapter } from './service-adapter.js';
import { getGoogleAccessToken, listGoogleCalendars } from './adapters/google.js';
import { verifyCalDavService, discoverCalDavCalendars } from './adapters/caldav.js';
import type { ConnectedService } from './adapter.js';

vi.mock('./adapters/google.js', () => ({
	getGoogleAccessToken: vi.fn(),
	listGoogleCalendars: vi.fn()
}));
vi.mock('./adapters/caldav.js', () => ({
	verifyCalDavService: vi.fn(),
	discoverCalDavCalendars: vi.fn()
}));

const google = (refresh_token: string | null): ConnectedService => ({
	name: 'gg',
	type: 'google',
	client_id: 'cid',
	client_secret: 'csec',
	refresh_token
});

const dav: ConnectedService = {
	name: 'dav',
	type: 'caldav',
	url: 'https://d.example/',
	username: 'u',
	password: 'p'
};

beforeEach(() => {
	vi.mocked(getGoogleAccessToken).mockReset().mockResolvedValue('access');
	vi.mocked(listGoogleCalendars).mockReset().mockResolvedValue([]);
	vi.mocked(verifyCalDavService).mockReset().mockResolvedValue(undefined);
	vi.mocked(discoverCalDavCalendars).mockReset().mockResolvedValue([]);
});

describe('google', () => {
	test('verifies by minting an access token from the stored refresh token', async () => {
		await getServiceAdapter(google('rt-1')).verify();

		expect(getGoogleAccessToken).toHaveBeenCalledWith(
			expect.objectContaining({ refresh_token: 'rt-1', client_id: 'cid' })
		);
	});

	test('refuses to reach google when no token is stored', async () => {
		await expect(getServiceAdapter(google(null)).verify()).rejects.toThrow(/not connected/);
		expect(getGoogleAccessToken).not.toHaveBeenCalled();
	});

	// Google reports the primary calendar with the account email as both summary and id.
	test('renames the primary calendar and uses the stable alias', async () => {
		vi.mocked(listGoogleCalendars).mockResolvedValue([
			{ id: 'jane@example.com', summary: 'jane@example.com', primary: true }
		]);

		expect(await getServiceAdapter(google('rt-1')).listCalendars()).toEqual([
			{ id: 'primary', name: 'Primary calendar', primary: true }
		]);
	});

	test('keeps a secondary calendar summary and id', async () => {
		vi.mocked(listGoogleCalendars).mockResolvedValue([
			{ id: 'c_a1b2@group.calendar.google.com', summary: 'Personal' }
		]);

		expect(await getServiceAdapter(google('rt-1')).listCalendars()).toEqual([
			{ id: 'c_a1b2@group.calendar.google.com', name: 'Personal', primary: false }
		]);
	});

	test('names the config field its ids belong in', () => {
		expect(getServiceAdapter(google('rt-1')).calendarIdField).toBe('google_calendar_id');
	});

	test('is an oauth service', () => {
		expect(getServiceAdapter(google(null)).usesOAuth).toBe(true);
	});
});

describe('caldav', () => {
	test('verifies against the configured credentials', async () => {
		await getServiceAdapter(dav).verify();
		expect(verifyCalDavService).toHaveBeenCalledWith(expect.objectContaining({ name: 'dav' }));
	});

	test('maps discovered calendars, using the path as the id', async () => {
		vi.mocked(discoverCalDavCalendars).mockResolvedValue([
			{ path: 'calendars/u/work/', displayName: 'Work' }
		]);

		expect(await getServiceAdapter(dav).listCalendars()).toEqual([
			{ id: 'calendars/u/work/', name: 'Work', primary: false }
		]);
	});

	test('names the config field its ids belong in', () => {
		expect(getServiceAdapter(dav).calendarIdField).toBe('path');
	});

	test('is not an oauth service', () => {
		expect(getServiceAdapter(dav).usesOAuth).toBe(false);
	});
});
