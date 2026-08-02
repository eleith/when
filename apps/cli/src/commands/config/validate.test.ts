import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { configCommand } from './index.ts';

// Get the validate subcommand
const validateCommand = configCommand.subCommands!.validate;

describe('config validate command', () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let originalExitCode: number | undefined;
	const tempValidPath = join(process.cwd(), 'temp-valid-config.yaml');
	const tempInvalidPath = join(process.cwd(), 'temp-invalid-config.yaml');
	const tempMissingEnvPath = join(process.cwd(), 'temp-missing-config.yaml');

	const validConfigYaml = `
auth:
  credentials:
    username: "admin"
    password: "securepassword"
user:
  name: "Jane Doe"
  email: "jane@example.com"
  timezone: "America/New_York"
smtp:
  host: "smtp.example.com"
  port: 587
  user: "smtp_user"
  pass: "smtp_pass"
providers:
  - name: "work-dav"
    type: "caldav"
    url: "https://example.com"
    username: "u"
    password: "p"
calendars:
  - name: "work"
    type: "caldav"
    provider: "work-dav"
    url: "https://example.com"
schedules:
  - name: "standard"
    weekly:
      - days: [mon]
        from: "09:00"
        to: "17:00"
meetings:
  - name: "chat"
    duration_minutes: 30
    slug: "chat"
    booking_approval: "instant"
    booking_calendar: "work"
    schedule: "standard"
database:
  app: "./data/when.sqlite"
  queue: "./data/openworkflow.sqlite"
url:
  app: "https://book.example.com"
`;

	const invalidConfigYaml = `
auth:
  credentials:
    username: "admin"
user:
  name: "Jane Doe"
`;

	const missingEnvConfigYaml = `
auth:
  credentials:
    username: "admin"
    password: "\${MISSING_TEST_ENV_VAR}"
user:
  name: "Jane Doe"
  email: "jane@example.com"
  timezone: "America/New_York"
smtp:
  host: "smtp.example.com"
  port: 587
  user: "smtp_user"
  pass: "smtp_pass"
providers:
  - name: "work-dav"
    type: "caldav"
    url: "https://example.com"
    username: "u"
    password: "p"
calendars:
  - name: "work"
    type: "caldav"
    provider: "work-dav"
    url: "https://example.com"
schedules:
  - name: "standard"
    weekly:
      - days: [mon]
        from: "09:00"
        to: "17:00"
meetings:
  - name: "chat"
    duration_minutes: 30
    slug: "chat"
    booking_approval: "instant"
    booking_calendar: "work"
    schedule: "standard"
database:
  app: "./data/when.sqlite"
  queue: "./data/openworkflow.sqlite"
url:
  app: "https://book.example.com"
`;

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		originalExitCode = process.exitCode as number | undefined;
		process.exitCode = undefined;

		// Write config fixtures
		writeFileSync(tempValidPath, validConfigYaml);
		writeFileSync(tempInvalidPath, invalidConfigYaml);
		writeFileSync(tempMissingEnvPath, missingEnvConfigYaml);
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		process.exitCode = originalExitCode;

		// Clean up files
		try {
			unlinkSync(tempValidPath);
		} catch {
			/* ignore */
		}
		try {
			unlinkSync(tempInvalidPath);
		} catch {
			/* ignore */
		}
		try {
			unlinkSync(tempMissingEnvPath);
		} catch {
			/* ignore */
		}
	});

	test('validates a valid configuration file successfully without extra logs', async () => {
		const ctx = {
			positionals: ['config', 'validate', tempValidPath],
			commandPath: ['config', 'validate']
		} as unknown as Parameters<NonNullable<typeof validateCommand.run>>[0];

		await validateCommand.run!(ctx);

		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`✅ ${tempValidPath}`));
		expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('auth:'));
	});

	test('accepts the path via the -c/--config flag', async () => {
		const ctx = {
			values: { config: tempValidPath },
			positionals: ['config', 'validate'],
			commandPath: ['config', 'validate']
		} as unknown as Parameters<NonNullable<typeof validateCommand.run>>[0];

		await validateCommand.run!(ctx);

		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`✅ ${tempValidPath}`));
	});

	test('validates a valid configuration file using relative path relative to INIT_CWD', async () => {
		const originalInitCwd = process.env.INIT_CWD;
		process.env.INIT_CWD = process.cwd();

		const relativePath = 'temp-valid-config.yaml';
		const ctx = {
			positionals: ['config', 'validate', relativePath],
			commandPath: ['config', 'validate']
		} as unknown as Parameters<NonNullable<typeof validateCommand.run>>[0];

		try {
			await validateCommand.run!(ctx);
			expect(process.exitCode).toBeUndefined();
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining(`✅ ${join(process.cwd(), relativePath)}`)
			);
		} finally {
			process.env.INIT_CWD = originalInitCwd;
		}
	});

	test('fails validating an invalid configuration file', async () => {
		const ctx = {
			positionals: ['config', 'validate', tempInvalidPath],
			commandPath: ['config', 'validate']
		} as unknown as Parameters<NonNullable<typeof validateCommand.run>>[0];

		await validateCommand.run!(ctx);

		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`❌ ${tempInvalidPath}`));
	});

	test('reports each issue at its line and column, not as a JSON Pointer', async () => {
		const ctx = {
			positionals: ['config', 'validate', tempInvalidPath],
			commandPath: ['config', 'validate']
		} as unknown as Parameters<NonNullable<typeof validateCommand.run>>[0];

		await validateCommand.run!(ctx);

		const details = errorSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('   '));
		expect(details.length).toBeGreaterThan(0);
		for (const line of details) {
			expect(line).toMatch(/^ {3}\d+:\d+ {2}/);
			expect(line).not.toContain('/user/');
		}
	});

	test('passes a config with unset env refs by default (structural)', async () => {
		const ctx = {
			positionals: ['config', 'validate', tempMissingEnvPath],
			commandPath: ['config', 'validate']
		} as unknown as Parameters<NonNullable<typeof validateCommand.run>>[0];

		await validateCommand.run!(ctx);

		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`✅ ${tempMissingEnvPath}`));
	});

	test('fails with --check-env when env variables are missing', async () => {
		const ctx = {
			values: { 'check-env': true },
			positionals: ['config', 'validate', tempMissingEnvPath],
			commandPath: ['config', 'validate']
		} as unknown as Parameters<NonNullable<typeof validateCommand.run>>[0];

		await validateCommand.run!(ctx);

		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`❌ ${tempMissingEnvPath}`));
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('missing env vars: MISSING_TEST_ENV_VAR')
		);
	});

	test('fails if specified file does not exist', async () => {
		const nonExistentPath = join(process.cwd(), 'does-not-exist.yaml');
		const ctx = {
			positionals: ['config', 'validate', nonExistentPath],
			commandPath: ['config', 'validate']
		} as unknown as Parameters<NonNullable<typeof validateCommand.run>>[0];

		await validateCommand.run!(ctx);

		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no config file found at'));
	});

	test('fails if default files do not exist and no path is passed', async () => {
		const originalInitCwd = process.env.INIT_CWD;
		// Point INIT_CWD to a directory that contains no config.yaml
		process.env.INIT_CWD = join(process.cwd(), 'nonexistent-directory-for-testing');

		const ctx = {
			positionals: ['config', 'validate'],
			commandPath: ['config', 'validate']
		} as unknown as Parameters<NonNullable<typeof validateCommand.run>>[0];

		try {
			await validateCommand.run!(ctx);

			expect(process.exitCode).toBe(1);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining('no config file found at default paths')
			);
		} finally {
			process.env.INIT_CWD = originalInitCwd;
		}
	});
});
