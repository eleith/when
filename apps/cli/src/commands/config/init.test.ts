import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { validateStructure } from '@when/config';
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
		if (existsSync(path)) unlinkSync(path);
	});

	function ctx() {
		return {
			values: { config: path },
			positionals: [],
			commandPath: ['config', 'init']
		} as unknown as Parameters<NonNullable<typeof initCommand.run>>[0];
	}

	test('writes a skeleton that passes structural validation', async () => {
		await initCommand.run!(ctx());
		expect(process.exitCode).toBeUndefined();
		expect(existsSync(path)).toBe(true);
		const content = readFileSync(path, 'utf8');
		expect(() => validateStructure(parseYaml(content))).not.toThrow();
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
