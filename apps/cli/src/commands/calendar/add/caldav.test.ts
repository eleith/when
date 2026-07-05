import { describe, expect, test, vi } from 'vitest';
import type { CalDavCalendar, WhenConfiguration } from '@when/config';
import { caldavAddCommand, verifyCalDavConnection } from './caldav.ts';

describe('caldav add command', () => {
	const cal: CalDavCalendar = {
		id: 'work',
		type: 'caldav',
		service_id: 'work-service',
		url: 'https://example.com/caldav/'
	};

	const testConfig = {
		services: [
			{
				id: 'work-service',
				type: 'caldav',
				url: 'https://example.com/caldav/',
				username: 'user',
				password: 'password'
			}
		],
		calendars: [cal]
	} as unknown as WhenConfiguration;

	test('verifyCalDavConnection resolves successfully on 200 OK response', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			text: async () => `
				<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
					<d:response>
						<d:href>/caldav/event.ics</d:href>
						<d:propstat>
							<d:status>HTTP/1.1 200 OK</d:status>
							<d:prop>
								<c:calendar-data>
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:123
DTSTART:20260630T090000Z
DTEND:20260630T100000Z
END:VEVENT
END:VCALENDAR
								</c:calendar-data>
							</d:prop>
						</d:propstat>
					</d:response>
				</d:multistatus>
			`
		});

		await expect(verifyCalDavConnection(cal, testConfig, mockFetch)).resolves.toBeUndefined();
		expect(mockFetch).toHaveBeenCalledWith(
			cal.url,
			expect.objectContaining({
				method: 'REPORT',
				headers: expect.objectContaining({
					Authorization: 'Basic dXNlcjpwYXNzd29yZA==',
					Depth: '1'
				})
			})
		);
	});

	test('verifyCalDavConnection throws an error on 401 Unauthorized response', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			text: async () => 'Unauthorized'
		});

		await expect(verifyCalDavConnection(cal, testConfig, mockFetch)).rejects.toThrow(
			'CalDAV REPORT https://example.com/caldav/ failed: 401 Unauthorized'
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
			} as unknown as Parameters<NonNullable<typeof caldavAddCommand.run>>[0];

			await caldavAddCommand.run!(ctx);

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
