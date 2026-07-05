import { describe, expect, test, vi } from 'vitest';
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
	} as unknown as WhenConfiguration;

	test('exchangeCodeForTokens returns tokens on successful POST', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				access_token: 'access-token-123',
				refresh_token: 'refresh-token-789',
				expires_in: 3600
			})
		});

		const tokens = await exchangeCodeForTokens(
			'client-id-123',
			'client-secret-456',
			'auth-code-000',
			'http://localhost',
			mockFetch
		);

		expect(tokens).toEqual({
			access_token: 'access-token-123',
			refresh_token: 'refresh-token-789',
			expires_in: 3600
		});

		expect(mockFetch).toHaveBeenCalledWith(
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
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 400,
			text: async () => 'invalid_grant'
		});

		await expect(
			exchangeCodeForTokens(
				'client-id-123',
				'client-secret-456',
				'auth-code-000',
				'http://localhost',
				mockFetch
			)
		).rejects.toThrow('Failed to exchange authorization code: 400 invalid_grant');
	});

	test('fetchCalendarList returns items on successful GET', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				items: [
					{ id: 'primary', summary: 'Primary Calendar', primary: true },
					{ id: 'work', summary: 'Work' }
				]
			})
		});

		const list = await fetchCalendarList('access-token-123', mockFetch);

		expect(list).toEqual([
			{ id: 'primary', summary: 'Primary Calendar', primary: true },
			{ id: 'work', summary: 'Work' }
		]);

		expect(mockFetch).toHaveBeenCalledWith(
			'https://www.googleapis.com/calendar/v3/users/me/calendarList',
			expect.objectContaining({
				headers: {
					Authorization: 'Bearer access-token-123'
				}
			})
		);
	});

	test('fetchCalendarList throws error if response is not ok', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			text: async () => 'Unauthorized'
		});

		await expect(fetchCalendarList('access-token-123', mockFetch)).rejects.toThrow(
			'Failed to fetch calendar list: 401 Unauthorized'
		);
	});

	test('verifyGoogleConnection resolves successfully when fetch busy times resolves', async () => {
		const mockFetch = vi.fn().mockImplementation(async (url: string) => {
			if (url.includes('oauth2.googleapis.com/token')) {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						access_token: 'access-token-123',
						expires_in: 3600
					})
				};
			}
			if (url.includes('googleapis.com/calendar/v3/calendars')) {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						items: [
							{
								id: 'event-1',
								status: 'confirmed',
								start: { dateTime: '2026-07-01T09:00:00Z' },
								end: { dateTime: '2026-07-01T10:00:00Z' }
							}
						]
					})
				};
			}
			return { ok: false, status: 404 };
		});

		await expect(verifyGoogleConnection(cal, testConfig, mockFetch)).resolves.toBeUndefined();
	});

	test('verifyGoogleConnection throws error when token endpoint fails', async () => {
		const mockFetch = vi.fn().mockImplementation(async (url: string) => {
			if (url.includes('oauth2.googleapis.com/token')) {
				return {
					ok: false,
					status: 400,
					statusText: 'Bad Request',
					text: async () => 'invalid_grant'
				};
			}
			return { ok: false, status: 404 };
		});

		const failedConfig = {
			services: [
				{
					...testService,
					refresh_token: 'refresh-token-failed-test'
				}
			],
			calendars: [cal]
		} as unknown as WhenConfiguration;
		await expect(verifyGoogleConnection(cal, failedConfig, mockFetch)).rejects.toThrow(
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
