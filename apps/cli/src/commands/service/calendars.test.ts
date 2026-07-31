import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getServiceAdapter } from '@when/calendar';
import { runServiceCalendars } from './calendars.ts';
import type { Service } from '@when/config';

vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return { ...actual, getServiceAdapter: vi.fn() };
});

// Provider behaviour belongs to the adapter; these cover what the command adds — the
// report it prints and the exit code it sets.
const adapter = {
	calendarIdField: 'google_calendar_id',
	usesOAuth: true,
	verify: vi.fn(),
	listCalendars: vi.fn()
};

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
		adapter.verify = vi.fn().mockResolvedValue(undefined);
		adapter.listCalendars = vi.fn().mockResolvedValue([]);
		vi.mocked(getServiceAdapter)
			.mockReset()
			.mockImplementation((service) => ({
				...adapter,
				usesOAuth: service.type === 'google',
				calendarIdField: service.type === 'google' ? 'google_calendar_id' : 'path'
			}));
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		process.exitCode = originalExitCode;
	});

	test('prints each calendar with the config field it belongs in', async () => {
		adapter.listCalendars = vi.fn().mockResolvedValue([
			{ id: 'primary', name: 'Primary calendar', primary: true },
			{ id: 'team@x.com', name: 'Team', primary: false }
		]);

		await runServiceCalendars(services, 'gg', 'rtok');

		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('gg (google) — 2 calendar(s):'));
		expect(logSpy).toHaveBeenCalledWith('  google_calendar_id: primary  Primary calendar');
		expect(logSpy).toHaveBeenCalledWith('  google_calendar_id: team@x.com  Team');
	});

	test('hands the adapter the refresh token it was given', async () => {
		await runServiceCalendars(services, 'gg', 'rtok');

		expect(getServiceAdapter).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'gg', refresh_token: 'rtok' })
		);
	});

	test('reports when a service exposes no calendars', async () => {
		await runServiceCalendars(services, 'gg', 'rtok');

		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('no calendars found'));
	});

	test('uses the caldav config field for a caldav service', async () => {
		adapter.listCalendars = vi
			.fn()
			.mockResolvedValue([{ id: 'calendars/u/work/', name: 'Work', primary: false }]);

		await runServiceCalendars(services, 'dav');

		expect(logSpy).toHaveBeenCalledWith('  path: calendars/u/work/  Work');
	});

	test('fails when the adapter throws', async () => {
		adapter.listCalendars = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));

		await runServiceCalendars(services, 'gg', 'rtok');

		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
	});

	test('fails on an unknown service name', async () => {
		await runServiceCalendars(services, 'nope');

		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no service named "nope"'));
	});
});
