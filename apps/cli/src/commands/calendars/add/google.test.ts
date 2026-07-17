import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { GoogleCalendar, Service } from '@when/config';
import { googleAddCommand, verifyGoogleConnection } from './google.ts';

describe('google add command helpers', () => {
	const cal: GoogleCalendar = {
		name: 'personal',
		type: 'google',
		service: 'google-service',
		google_calendar_id: 'primary'
	};

	const testService = {
		name: 'google-service',
		type: 'google' as const,
		client_id: 'client-id-123',
		client_secret: 'client-secret-456',
		refresh_token: 'refresh-token-789'
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	test('verifyGoogleConnection resolves successfully when fetch busy times resolves', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: Parameters<typeof fetch>[0]) => {
			if (String(url).includes('oauth2.googleapis.com/token')) {
				return new Response(
					JSON.stringify({
						access_token: 'access-token-123',
						expires_in: 3600
					}),
					{ status: 200 }
				);
			}
			if (String(url).includes('googleapis.com/calendar/v3/calendars')) {
				return new Response(
					JSON.stringify({
						items: [
							{
								id: 'event-1',
								status: 'confirmed',
								start: { dateTime: '2026-07-01T09:00:00Z' },
								end: { dateTime: '2026-07-01T10:00:00Z' }
							}
						]
					}),
					{ status: 200 }
				);
			}
			return new Response(null, { status: 404 });
		});

		await expect(verifyGoogleConnection(cal, testService)).resolves.toBeUndefined();
	});

	test('verifyGoogleConnection throws error when token endpoint fails', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: Parameters<typeof fetch>[0]) => {
			if (String(url).includes('oauth2.googleapis.com/token')) {
				return new Response('invalid_grant', { status: 400, statusText: 'Bad Request' });
			}
			return new Response(null, { status: 404 });
		});

		const failedService: Service = {
			...testService,
			refresh_token: 'refresh-token-failed-test'
		};
		await expect(verifyGoogleConnection(cal, failedService)).rejects.toThrow(
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
