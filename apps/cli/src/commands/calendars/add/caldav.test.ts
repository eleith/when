import { afterEach, describe, expect, test, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { text, select, note } from '@clack/prompts';
import type { CalDavCalendar, Service } from '@when/config';
import { ConfigEditor } from '@when/config';
import { caldavAddCommand, verifyCalDavConnection } from './caldav.ts';

vi.mock('@clack/prompts', () => ({
	text: vi.fn(),
	select: vi.fn(),
	password: vi.fn(),
	note: vi.fn(),
	isCancel: vi.fn().mockReturnValue(false),
	spinner: vi.fn().mockReturnValue({ start: vi.fn(), message: vi.fn(), stop: vi.fn() })
}));

const ENV_VAR = 'WHEN_SERVICE_CALDAV_WORK_PASSWORD';

const REUSE_CONFIG = `services:
  - name: work-service
    type: caldav
    url: https://cloud.example.com/remote.php/dav/
    username: user
    password: \${${ENV_VAR}}
calendars:
  - name: work
    type: caldav
    service: work-service
    path: calendars/user/work/
`;

describe('caldav add command', () => {
	const cal: CalDavCalendar = {
		name: 'work',
		type: 'caldav',
		service: 'work-service',
		url: 'https://example.com/caldav/'
	};

	const testService: Service = {
		name: 'work-service',
		type: 'caldav',
		url: 'https://example.com/caldav/',
		username: 'user',
		password: 'password'
	};

	const tempConfigPath = join(process.cwd(), 'temp-caldav-config.yaml');

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.mocked(note).mockReset();
	});

	afterEach(() => {
		delete process.env[ENV_VAR];
		try {
			unlinkSync(tempConfigPath);
		} catch {
			/* ignore */
		}
	});

	test('verifyCalDavConnection resolves successfully on 200 OK response', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
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
		} as Response);

		await expect(verifyCalDavConnection(cal, testService)).resolves.toBeUndefined();
		expect(fetchSpy).toHaveBeenCalledWith(
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
		vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			text: async () => 'Unauthorized'
		} as Response);

		await expect(verifyCalDavConnection(cal, testService)).rejects.toThrow(
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

	const okReport = () =>
		vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			text: async () => `
				<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
				</d:multistatus>
			`
		} as Response);

	test("reusing a service prompts for and writes the new calendar's own path", async () => {
		writeFileSync(tempConfigPath, REUSE_CONFIG);
		process.env[ENV_VAR] = 'secret';

		vi.mocked(text)
			.mockResolvedValueOnce('personal') // calendar name
			.mockResolvedValueOnce('calendars/user/personal/'); // endpoint (relative → path)
		vi.mocked(select).mockResolvedValueOnce('work-service'); // reuse existing service
		const fetchSpy = okReport();

		const ctx = {
			values: { config: tempConfigPath },
			positionals: [],
			commandPath: []
		} as unknown as Parameters<NonNullable<typeof caldavAddCommand.run>>[0];

		await caldavAddCommand.run!(ctx);

		const editor = new ConfigEditor(tempConfigPath);
		expect((editor.get('services') as unknown[]).length).toBe(1); // reused, not appended
		expect(editor.get('calendars.1')).toEqual({
			name: 'personal',
			type: 'caldav',
			service: 'work-service',
			path: 'calendars/user/personal/'
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			'https://cloud.example.com/remote.php/dav/calendars/user/personal/',
			expect.objectContaining({ method: 'REPORT' })
		);
	});

	test('reusing a service whose password env var is unset shows a set-the-var message', async () => {
		writeFileSync(tempConfigPath, REUSE_CONFIG);
		delete process.env[ENV_VAR];

		vi.mocked(text).mockResolvedValueOnce('personal'); // calendar name
		vi.mocked(select).mockResolvedValueOnce('work-service'); // reuse existing service
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		const originalExitCode = process.exitCode;
		process.exitCode = undefined;

		try {
			const ctx = {
				values: { config: tempConfigPath },
				positionals: [],
				commandPath: []
			} as unknown as Parameters<NonNullable<typeof caldavAddCommand.run>>[0];

			await caldavAddCommand.run!(ctx);

			expect(process.exitCode).toBe(1);
			expect(fetchSpy).not.toHaveBeenCalled();
			expect(vi.mocked(note).mock.calls[0]?.[0] ?? '').toContain(ENV_VAR);
			expect((new ConfigEditor(tempConfigPath).get('calendars') as unknown[]).length).toBe(1);
		} finally {
			process.exitCode = originalExitCode;
		}
	});
});
