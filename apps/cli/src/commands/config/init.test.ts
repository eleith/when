import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, readFileSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { validateConfig, validateStructure } from '@when/config';
import { initCommand } from './init.ts';

describe('config init', () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let originalExitCode: number | undefined;
	const path = join(process.cwd(), 'temp-init-config.yaml');

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		originalExitCode = process.exitCode as number | undefined;
		process.exitCode = undefined;
		if (existsSync(path)) unlinkSync(path);
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		process.exitCode = originalExitCode;
		vi.unstubAllEnvs();
		if (existsSync(path)) unlinkSync(path);
	});

	function ctx() {
		return {
			values: { config: path },
			positionals: [],
			commandPath: ['config', 'init']
		} as unknown as Parameters<NonNullable<typeof initCommand.run>>[0];
	}

	test('writes a YAML-first starter that validates after its blank passwords are filled', async () => {
		vi.stubEnv('WHEN_ADMIN_PASSWORD', undefined);
		vi.stubEnv('WHEN_SMTP_PASSWORD', undefined);
		vi.stubEnv('WHEN_PROVIDER_MY_CALDAV_PASSWORD', undefined);

		await initCommand.run!(ctx());
		expect(process.exitCode).toBeUndefined();
		expect(existsSync(path)).toBe(true);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		const content = readFileSync(path, 'utf8');
		const raw = parseYaml(content);
		expect(content).not.toContain('${');
		expect(raw.auth.credentials).toEqual({ username: 'admin', password: '' });
		expect(raw.auth.secret).toBeUndefined();
		expect(raw.smtp.password).toBe('');
		expect(raw.providers['my-caldav'].password).toBe('');
		expect(() => validateStructure(raw)).toThrow('schema validation');

		raw.auth.credentials.password = 'test-only-admin-password';
		raw.smtp.password = 'test-only-smtp-password';
		raw.providers['my-caldav'].password = 'test-only-caldav-password';
		const config = validateConfig(raw);
		expect(config.database).toEqual({
			app: './data/when.sqlite',
			queue: './data/openworkflow.sqlite'
		});
		expect(config.schedules.standard.weekly).toEqual([
			{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }
		]);
		expect(config.smtp.port).toBe(587);
		expect(config.meetings['30-min'].duration_minutes).toBe(30);
		expect(config.url.app).toBe('https://book.example.com');
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('config validate'));
	});

	test('refuses to overwrite an existing file', async () => {
		writeFileSync(path, 'existing: true\n');
		await initCommand.run!(ctx());
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
		expect(readFileSync(path, 'utf8')).toBe('existing: true\n');
	});
});
