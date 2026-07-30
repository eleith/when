import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getGoogleAccessToken, listGoogleCalendars, discoverCalDavCalendars } from '@when/calendar';
import { runServiceCalendars } from './calendars.ts';
import type { Service } from '@when/config';

vi.mock('@when/calendar', () => ({
	getGoogleAccessToken: vi.fn(),
	listGoogleCalendars: vi.fn(),
	discoverCalDavCalendars: vi.fn()
}));

const gg: Service = {
	name: 'gg',
	type: 'google',
	client_id: 'cid',
	client_secret: 'csecret'
} as Service;
const dav: Service = {
	name: 'dav',
	type: 'caldav',
	url: 'https://dav.example.com/',
	username: 'u',
	password: 'p'
} as Service;
const services: Service[] = [gg, dav];

describe('service calendars action', () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let originalExitCode: number | undefined;

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		originalExitCode = process.exitCode as number | undefined;
		process.exitCode = undefined;
		vi.mocked(getGoogleAccessToken).mockReset().mockResolvedValue('access');
		vi.mocked(listGoogleCalendars).mockReset();
		vi.mocked(discoverCalDavCalendars).mockReset();
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		process.exitCode = originalExitCode;
	});

	test('lists google calendars with ids and primary marker', async () => {
		vi.mocked(listGoogleCalendars).mockResolvedValue([
			{ id: 'primary', summary: 'Me', primary: true },
			{ id: 'team@x.com', summary: 'Team' }
		]);
		await runServiceCalendars(services, 'gg', 'rtok');
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✅ gg (google) — 2 calendar(s):'));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('primary  (primary)  Me'));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('team@x.com  Team'));
	});

	test('reports when google has no calendars', async () => {
		vi.mocked(listGoogleCalendars).mockResolvedValue([]);
		await runServiceCalendars(services, 'gg', 'rtok');
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('no calendars found'));
	});

	test('fails when google auth throws', async () => {
		vi.mocked(getGoogleAccessToken).mockRejectedValue(new Error('token refresh failed'));
		await runServiceCalendars(services, 'gg', 'rtok');
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('❌ gg (google)'));
		expect(listGoogleCalendars).not.toHaveBeenCalled();
	});

	test('lists caldav calendars with paths', async () => {
		vi.mocked(discoverCalDavCalendars).mockResolvedValue([
			{ displayName: 'Work', path: 'calendars/u/work/' }
		]);
		await runServiceCalendars(services, 'dav');
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining('✅ dav (caldav) — 1 calendar(s):')
		);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('calendars/u/work/  Work'));
	});

	test('fails when caldav discovery throws', async () => {
		vi.mocked(discoverCalDavCalendars).mockRejectedValue(new Error('bad credentials (401)'));
		await runServiceCalendars(services, 'dav');
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bad credentials (401)'));
	});

	test('fails for an unknown service name', async () => {
		await runServiceCalendars(services, 'nope');
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no service named "nope"'));
	});
});
