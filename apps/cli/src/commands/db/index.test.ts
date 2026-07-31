import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb, runMigrations } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { dbCommand } from './index.ts';
import { runDbStatus } from './status.ts';
import { runDbMigrate } from './migrate.ts';

const dir = join(tmpdir(), 'when-cli-db-command-test');
const dbPath = join(dir, 'when.sqlite');

const configFor = (app: string) => ({ database: { app } }) as unknown as WhenConfiguration;

describe('db command', () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let originalExitCode: number | undefined;

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		originalExitCode = process.exitCode as number | undefined;
		process.exitCode = undefined;
		rmSync(dir, { recursive: true, force: true });
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		process.exitCode = originalExitCode;
		rmSync(dir, { recursive: true, force: true });
	});

	test('bare db prints usage', () => {
		dbCommand.run!();
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('when-cli db status'));
	});

	test('status on a missing database reports it and creates nothing', async () => {
		await runDbStatus(dbPath);
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no database at'));
		expect(existsSync(dir)).toBe(false);
	});

	test('status lists pending migrations on an empty database', async () => {
		const created = openDb(dbPath);
		await created.destroy();

		await runDbStatus(dbPath);
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('pending'));
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('0001_initial'));
	});

	test('status reports up to date once migrated', async () => {
		const created = openDb(dbPath);
		await runMigrations(created);
		await created.destroy();

		await runDbStatus(dbPath);
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('up to date'));
	});

	test('migrate applies pending migrations and names them', async () => {
		await runDbMigrate(configFor(dbPath));
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('migration(s) applied'));
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('0001_initial'));
	});

	test('migrate is idempotent on a second run', async () => {
		await runDbMigrate(configFor(dbPath));
		logSpy.mockClear();

		await runDbMigrate(configFor(dbPath));
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already up to date'));
	});
});
