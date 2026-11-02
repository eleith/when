import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import type { ConfigPathOptions } from '@when/config';
import type { Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { bootApp } from './boot';
import { getState } from './state';
import { validConfig } from './__fixtures__/valid-config';

type Listener = (current: Stats, previous: Stats) => Promise<void>;
const mocks = vi.hoisted(() => ({
	watchFile: vi.fn<(path: string, options: object, listener: Listener) => void>(),
	unwatchFile: vi.fn(),
	loadConfigFile: vi.fn(),
	makeAuth: vi.fn(),
	openDb: vi.fn(),
	runMigrations: vi.fn().mockResolvedValue([])
}));
vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	return { ...actual, watchFile: mocks.watchFile, unwatchFile: mocks.unwatchFile };
});
vi.mock('@when/config', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/config')>();
	return { ...actual, loadConfigFile: mocks.loadConfigFile };
});
vi.mock('@when/db', () => ({ openDb: mocks.openDb, runMigrations: mocks.runMigrations }));
vi.mock('@when/jobs', () => ({ initOpenWorkflow: vi.fn() }));
vi.mock('@when/calendar', () => ({ setLogger: vi.fn() }));
vi.mock('./auth', () => ({ makeAuth: mocks.makeAuth }));
vi.mock('./logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}));

let directory: string;
const database = {};

function emitShutdown(): void {
	EventEmitter.prototype.emit.call(process, 'sveltekit:shutdown');
}

beforeEach(async () => {
	vi.resetAllMocks();
	const { loadConfigFile } = await vi.importActual<typeof import('@when/config')>('@when/config');
	mocks.loadConfigFile.mockImplementation(loadConfigFile);
	mocks.openDb.mockReturnValue(database);
	mocks.runMigrations.mockResolvedValue([]);
	vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
	directory = await mkdtemp(join(tmpdir(), 'when-app-boot-'));
	await writeFile(join(directory, 'when.yaml'), stringify(validConfig));
});

afterEach(async () => {
	emitShutdown();
	vi.restoreAllMocks();
	await rm(directory, { recursive: true, force: true });
});

test('initial load and reload keep bare-filename database roots and existing resources', async () => {
	const path = join(directory, 'when.yaml');
	await bootApp({ cwd: directory, env: { CONFIG_PATH: 'when.yaml' } });
	const previous = await stat(path);
	const next = { ...validConfig, user: { ...validConfig.user, name: 'Reloaded owner' } };
	await writeFile(path, stringify(next));
	const listener = mocks.watchFile.mock.calls[0][2];
	await listener(await stat(path), previous);

	const state = getState();
	expect(state.config.user.name).toBe('Reloaded owner');
	expect(state.config.database.app).toBe(join(directory, 'data', 'when.sqlite'));
	expect(state.config.database.queue).toBe(join(directory, 'data', 'openworkflow.sqlite'));
	expect(state.db).toBe(database);
	expect(mocks.openDb).toHaveBeenCalledExactlyOnceWith(join(directory, 'data', 'when.sqlite'));
	expect(mocks.makeAuth).toHaveBeenCalledOnce();
	expect(process.exit).not.toHaveBeenCalled();
});

test('shutdown during startup reconciliation already owns stop and prevents late application', async () => {
	const { loadConfigFile } = await vi.importActual<typeof import('@when/config')>('@when/config');
	const reading = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	mocks.loadConfigFile
		.mockImplementationOnce(loadConfigFile)
		.mockImplementationOnce(async (path?: string, options?: ConfigPathOptions) => {
			reading.resolve();
			await release.promise;
			return loadConfigFile(path, options);
		});
	const startup = bootApp({ cwd: directory, env: { CONFIG_PATH: 'when.yaml' } });
	try {
		await reading.promise;
		await writeFile(
			join(directory, 'when.yaml'),
			stringify({ ...validConfig, user: { ...validConfig.user, name: 'Too late' } })
		);
		emitShutdown();
		expect(mocks.unwatchFile).toHaveBeenCalledExactlyOnceWith(
			join(directory, 'when.yaml'),
			mocks.watchFile.mock.calls[0][2]
		);
	} finally {
		release.resolve();
		await startup;
	}
	expect(getState().config.user.name).toBe(validConfig.user.name);
	expect(mocks.makeAuth).toHaveBeenCalledOnce();
	expect(process.exit).not.toHaveBeenCalled();
});
