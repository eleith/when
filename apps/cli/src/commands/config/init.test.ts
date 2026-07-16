import { afterEach, describe, expect, test, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { text, select, note } from '@clack/prompts';
import { ConfigEditor, validateStructure } from '@when/config';
import { parse as parseYaml } from 'yaml';
import { initCommand } from './init.ts';

vi.mock('@clack/prompts', () => ({
	text: vi.fn(),
	select: vi.fn(),
	note: vi.fn(),
	isCancel: vi.fn().mockReturnValue(false)
}));

// The calendar/schedule/meeting wizards are tested in their own files; here we
// stub them to write deterministic sections so the init test exercises
// composition (skeleton + delegation order + final validation) on its own.
vi.mock('../calendars/add/caldav.ts', async () => {
	const { ConfigEditor } = await import('@when/config');
	return {
		caldavAddCommand: {
			run: vi.fn(async (ctx: { values: { config: string } }) => {
				const editor = new ConfigEditor(ctx.values.config);
				editor.set('services.0', {
					name: 'work-service',
					type: 'caldav',
					url: 'https://cloud.example.com/remote.php/dav/',
					username: 'u',
					password: '${WHEN_SERVICE_CALDAV_WORK_PASSWORD}'
				});
				editor.set('calendars.0', {
					name: 'work',
					type: 'caldav',
					service: 'work-service',
					path: 'calendars/u/work/'
				});
			})
		}
	};
});
vi.mock('../calendars/add/nextcloud.ts', () => ({ nextcloudAddCommand: { run: vi.fn() } }));
vi.mock('../calendars/add/google.ts', () => ({ googleAddCommand: { run: vi.fn() } }));
vi.mock('../schedules/add.ts', async () => {
	const { ConfigEditor } = await import('@when/config');
	return {
		schedulesAddCommand: {
			run: vi.fn(async (ctx: { values: { config: string } }) => {
				new ConfigEditor(ctx.values.config).set('schedules.0', {
					name: 'standard',
					weekly: { monday: ['09:00-17:00'] }
				});
			})
		}
	};
});
vi.mock('../meetings/add.ts', async () => {
	const { ConfigEditor } = await import('@when/config');
	return {
		meetingsAddCommand: {
			run: vi.fn(async (ctx: { values: { config: string } }) => {
				new ConfigEditor(ctx.values.config).set('meetings.0', {
					name: 'chat',
					slug: 'chat',
					duration_minutes: 30,
					booking_approval: 'instant',
					visibility: 'public',
					schedule: 'standard',
					booking_calendar: 'work'
				});
			})
		}
	};
});

describe('config init command', () => {
	const tempConfigPath = join(process.cwd(), 'temp-init-config.yaml');

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
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
		}) as unknown as Parameters<NonNullable<typeof initCommand.run>>[0];

	test('composes a config file that passes structural validation', async () => {
		const originalExitCode = process.exitCode;
		process.exitCode = undefined;

		vi.mocked(select)
			.mockResolvedValueOnce('credentials') // auth method
			.mockResolvedValueOnce('caldav'); // calendar type
		vi.mocked(text)
			.mockResolvedValueOnce('admin') // auth username
			.mockResolvedValueOnce('Jane Doe') // user name
			.mockResolvedValueOnce('jane@example.com') // user email
			.mockResolvedValueOnce('UTC') // user timezone
			.mockResolvedValueOnce('smtp.example.com') // smtp host
			.mockResolvedValueOnce('587') // smtp port
			.mockResolvedValueOnce('mailer') // smtp user
			.mockResolvedValueOnce(''); // smtp from (blank)

		try {
			await initCommand.run!(ctxFor(tempConfigPath));

			expect(process.exitCode).toBeUndefined();
			expect(existsSync(tempConfigPath)).toBe(true);

			const parsed = parseYaml(readFileSync(tempConfigPath, 'utf8'));
			expect(() => validateStructure(parsed)).not.toThrow();

			const editor = new ConfigEditor(tempConfigPath);
			expect(editor.get('auth.credentials.username')).toBe('admin');
			expect(editor.get('calendars.0.name')).toBe('work');
			expect(editor.get('meetings.0.name')).toBe('chat');

			// the summary lists the env vars the user still needs to set
			const summary = String(vi.mocked(note).mock.calls.at(-1)?.[0] ?? '');
			expect(summary).toContain('WHEN_ADMIN_PASSWORD');
			expect(summary).toContain('WHEN_SMTP_PASS');
		} finally {
			process.exitCode = originalExitCode;
		}
	});

	test('refuses to overwrite an existing file', async () => {
		writeFileSync(tempConfigPath, 'auth: {}\n');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const originalExitCode = process.exitCode;
		process.exitCode = undefined;

		try {
			await initCommand.run!(ctxFor(tempConfigPath));

			expect(process.exitCode).toBe(1);
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
			expect(vi.mocked(select)).not.toHaveBeenCalled(); // bailed before prompting
			expect(readFileSync(tempConfigPath, 'utf8')).toBe('auth: {}\n'); // untouched
		} finally {
			errorSpy.mockRestore();
			process.exitCode = originalExitCode;
		}
	});
});
