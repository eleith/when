import { afterEach, describe, expect, test, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { text, select, password, note } from '@clack/prompts';
import { ConfigEditor } from '@when/config';
import { nextcloudAddCommand } from './nextcloud.ts';

vi.mock('@clack/prompts', () => ({
	text: vi.fn(),
	select: vi.fn(),
	password: vi.fn(),
	note: vi.fn(),
	isCancel: vi.fn().mockReturnValue(false),
	spinner: vi.fn().mockReturnValue({ start: vi.fn(), message: vi.fn(), stop: vi.fn() })
}));

const ENV_VAR = 'WHEN_SERVICE_NEXTCLOUD_HOME_PASSWORD';

const REUSE_CONFIG = `services:
  - name: home-service
    type: nextcloud
    url: https://cloud.example.com
    username: ncuser
    password: \${${ENV_VAR}}
calendars:
  - name: home
    type: caldav
    service: home-service
    path: calendars/ncuser/home/
`;

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

describe('nextcloud add command', () => {
	const tempConfigPath = join(process.cwd(), 'temp-nextcloud-config.yaml');

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

	const ctxFor = (config: string) =>
		({
			values: { config },
			positionals: [],
			commandPath: []
		}) as unknown as Parameters<NonNullable<typeof nextcloudAddCommand.run>>[0];

	test('a new service writes a nextcloud service and a caldav calendar bound to it', async () => {
		writeFileSync(tempConfigPath, 'meetings: []\n');

		vi.mocked(text)
			.mockResolvedValueOnce('personal') // calendar name
			.mockResolvedValueOnce('https://cloud.example.com') // instance base URL
			.mockResolvedValueOnce('ncuser') // username
			.mockResolvedValueOnce('calendars/ncuser/personal/'); // endpoint (relative → path)
		vi.mocked(password).mockResolvedValueOnce('secret');
		const fetchSpy = okReport();

		await nextcloudAddCommand.run!(ctxFor(tempConfigPath));

		const editor = new ConfigEditor(tempConfigPath);
		expect(editor.get('services.0')).toEqual({
			name: 'personal-service',
			type: 'nextcloud',
			url: 'https://cloud.example.com',
			username: 'ncuser',
			password: '${WHEN_SERVICE_NEXTCLOUD_PERSONAL_PASSWORD}'
		});
		expect(editor.get('calendars.0')).toEqual({
			name: 'personal',
			type: 'caldav',
			service: 'personal-service',
			path: 'calendars/ncuser/personal/'
		});
		// nextcloud base URL is resolved through /remote.php/dav for verification
		expect(fetchSpy).toHaveBeenCalledWith(
			'https://cloud.example.com/remote.php/dav/calendars/ncuser/personal/',
			expect.objectContaining({ method: 'REPORT' })
		);
	});

	test('reusing a service whose password env var is unset shows a set-the-var message', async () => {
		writeFileSync(tempConfigPath, REUSE_CONFIG);
		delete process.env[ENV_VAR];

		vi.mocked(text).mockResolvedValueOnce('personal'); // calendar name
		vi.mocked(select).mockResolvedValueOnce('home-service'); // reuse existing service
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		const originalExitCode = process.exitCode;
		process.exitCode = undefined;

		try {
			await nextcloudAddCommand.run!(ctxFor(tempConfigPath));

			expect(process.exitCode).toBe(1);
			expect(fetchSpy).not.toHaveBeenCalled();
			expect(vi.mocked(note).mock.calls[0]?.[0] ?? '').toContain(ENV_VAR);
			expect((new ConfigEditor(tempConfigPath).get('calendars') as unknown[]).length).toBe(1);
		} finally {
			process.exitCode = originalExitCode;
		}
	});
});
