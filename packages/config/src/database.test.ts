import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { validateConfig, loadConfigFile } from './load.js';
import { validConfig } from './__fixtures__/valid-config.js';

test('database paths default when the section is omitted', () => {
	const { database: _omit, ...withoutDatabase } = validConfig;
	const config = validateConfig(withoutDatabase);
	expect(config.database).toEqual({
		app: './data/when.sqlite',
		queue: './data/openworkflow.sqlite'
	});
});

let dir: string;
const saved = { ...process.env };

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'when-config-'));
	delete process.env.DATABASE_PATH;
	delete process.env.QUEUE_DB_PATH;
});

afterEach(async () => {
	process.env = { ...saved };
	await rm(dir, { recursive: true, force: true });
});

test('loadConfigFile resolves relative db paths against the config dir', async () => {
	const path = join(dir, 'config.yaml');
	await writeFile(path, stringify(validConfig));
	const config = await loadConfigFile(path);
	expect(config.database.app).toBe(join(dir, 'data', 'when.sqlite'));
	expect(config.database.queue).toBe(join(dir, 'data', 'openworkflow.sqlite'));
});

test('DATABASE_PATH / QUEUE_DB_PATH override the resolved paths', async () => {
	process.env.DATABASE_PATH = '/var/lib/when/app.sqlite';
	process.env.QUEUE_DB_PATH = '/var/lib/when/jobs.sqlite';
	const path = join(dir, 'config.yaml');
	await writeFile(path, stringify(validConfig));
	const config = await loadConfigFile(path);
	expect(config.database.app).toBe('/var/lib/when/app.sqlite');
	expect(config.database.queue).toBe('/var/lib/when/jobs.sqlite');
});
