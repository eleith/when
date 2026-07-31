import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb, runMigrations } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { openAppDb, openAppDbForMigration } from './db.ts';

const dir = join(tmpdir(), 'when-cli-db-test');
const dbPath = join(dir, 'when.sqlite');

const configFor = (app: string) => ({ database: { app } }) as unknown as WhenConfiguration;

describe('openAppDb', () => {
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let originalExitCode: number | undefined;

	beforeEach(() => {
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		originalExitCode = process.exitCode as number | undefined;
		process.exitCode = undefined;
		rmSync(dir, { recursive: true, force: true });
	});

	afterEach(() => {
		errorSpy.mockRestore();
		process.exitCode = originalExitCode;
		rmSync(dir, { recursive: true, force: true });
	});

	test('a missing database is reported without being created', async () => {
		expect(await openAppDb(configFor(dbPath))).toBeNull();
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no database at'));
		expect(existsSync(dbPath)).toBe(false);
		expect(existsSync(dir)).toBe(false);
	});

	test('a database behind on migrations is refused, not queried', async () => {
		const created = openDb(dbPath);
		await created.destroy();

		expect(await openAppDb(configFor(dbPath))).toBeNull();
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('schema is behind'));
	});

	test('a migrated database opens', async () => {
		const created = openAppDbForMigration(configFor(dbPath));
		await runMigrations(created);
		await created.destroy();

		const db = await openAppDb(configFor(dbPath));
		expect(db).not.toBeNull();
		expect(process.exitCode).toBeUndefined();
		await db?.destroy();
	});

	test('openAppDbForMigration creates the database and its directory', () => {
		const db = openAppDbForMigration(configFor(dbPath));
		expect(existsSync(dbPath)).toBe(true);
		void db.destroy();
	});
});
