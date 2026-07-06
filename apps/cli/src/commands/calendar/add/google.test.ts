import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { GoogleCalendar, WhenConfiguration } from '@when/config';
import {
	googleAddCommand,
	verifyGoogleConnection,
	exchangeCodeForTokens,
	fetchCalendarList
} from './google.ts';

describe('google add command helpers', () => {
	const cal: GoogleCalendar = {
		id: 'personal',
		type: 'google',
		service_id: 'google-service',
		google_calendar_id: 'primary'
	};

	const testService = {
		id: 'google-service',
		type: 'google' as const,
		client_id: 'client-id-123',
		client_secret: 'client-secret-456',
		refresh_token: 'refresh-token-789'
	};

	const testConfig = {
		services: [testService],
		calendars: [cal]
	} as WhenConfiguration;

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	test('exchangeCodeForTokens returns tokens on successful POST', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				access_token: 'access-token-123',
				refresh_token: 'refresh-token-789',
				expires_in: 3600
			})
		} as Response);

		const tokens = await exchangeCodeForTokens(
			'client-id-123',
			'client-secret-456',
			'auth-code-000',
			'http://localhost'
		);

		expect(tokens).toEqual({
			access_token: 'access-token-123',
			refresh_token: 'refresh-token-789',
			expires_in: 3600
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			'https://oauth2.googleapis.com/token',
			expect.objectContaining({
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body: expect.any(URLSearchParams)
			})
		);
	});

	test('exchangeCodeForTokens throws error if response is not ok', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: false,
			status: 400,
			text: async () => 'invalid_grant'
		} as Response);

		await expect(
			exchangeCodeForTokens(
				'client-id-123',
				'client-secret-456',
				'auth-code-000',
				'http://localhost'
			)
		).rejects.toThrow('Failed to exchange authorization code: 400 invalid_grant');
	});

	test('fetchCalendarList returns items on successful GET', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				items: [
					{ id: 'primary', summary: 'Primary Calendar', primary: true },
					{ id: 'work', summary: 'Work' }
				]
			})
		} as Response);

		const list = await fetchCalendarList('access-token-123');

		expect(list).toEqual([
			{ id: 'primary', summary: 'Primary Calendar', primary: true },
			{ id: 'work', summary: 'Work' }
		]);

		expect(fetchSpy).toHaveBeenCalledWith(
			'https://www.googleapis.com/calendar/v3/users/me/calendarList',
			expect.objectContaining({
				headers: {
					Authorization: 'Bearer access-token-123'
				}
			})
		);
	});

	test('fetchCalendarList throws error if response is not ok', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: false,
			status: 401,
			text: async () => 'Unauthorized'
		} as Response);

		await expect(fetchCalendarList('access-token-123')).rejects.toThrow(
			'Failed to fetch calendar list: 401 Unauthorized'
		);
	});

	test('verifyGoogleConnection resolves successfully when fetch busy times resolves', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
			if (String(url).includes('oauth2.googleapis.com/token')) {
				return new Response(JSON.stringify({
					access_token: 'access-token-123',
					expires_in: 3600
				}), { status: 200 });
			}
			if (String(url).includes('googleapis.com/calendar/v3/calendars')) {
				return new Response(JSON.stringify({
					items: [
						{
							id: 'event-1',
							status: 'confirmed',
							start: { dateTime: '2026-07-01T09:00:00Z' },
							end: { dateTime: '2026-07-01T10:00:00Z' }
						}
					]
				}), { status: 200 });
			}
			return new Response(null, { status: 404 });
		});

		await expect(verifyGoogleConnection(cal, testConfig)).resolves.toBeUndefined();
	});

	test('verifyGoogleConnection throws error when token endpoint fails', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
			if (String(url).includes('oauth2.googleapis.com/token')) {
				return new Response('invalid_grant', { status: 400, statusText: 'Bad Request' });
			}
			return new Response(null, { status: 404 });
		});

		const failedConfig = {
			services: [
				{
					...testService,
					refresh_token: 'refresh-token-failed-test'
				}
			],
			calendars: [cal]
		} as WhenConfiguration;
		await expect(verifyGoogleConnection(cal, failedConfig)).rejects.toThrow(
			'Google token refresh failed: 400 Bad Request'
		);
	});

	test('command execution fails if configuration file does not exist', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const originalExitCode = process.exitCode;
		process.exitCode = undefined;

		try {
			const ctx = {
				values: { config: 'nonexistent-config.yaml' },
				positionals: [],
				commandPath: []
			} as unknown as Parameters<NonNullable<typeof googleAddCommand.run>>[0];

			await googleAddCommand.run!(ctx);

			expect(process.exitCode).toBe(1);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('FAIL  No configuration file found at:')
			);
		} finally {
			errorSpy.mockRestore();
			process.exitCode = originalExitCode;
		}
	});
});
