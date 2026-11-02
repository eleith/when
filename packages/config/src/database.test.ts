import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { validateConfig, loadConfigFile } from './load.js';
import { validConfig } from './__fixtures__/valid-config.js';

test('database paths default when the section is omitted', () => {
	const { database: _omit, ...withoutDatabase } = validConfig;
	const config = validateConfig(withoutDatabase, { env: {} });
	expect(config.database).toEqual({
		app: './data/when.sqlite',
		queue: './data/openworkflow.sqlite'
	});
});

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'when-config-'));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

test('an explicit relative file is read from cwd and resolves db paths against the deployment root', async () => {
	await mkdir(join(dir, 'config'));
	await writeFile(join(dir, 'config', 'when.yaml'), stringify(validConfig));
	const config = await loadConfigFile('config/when.yaml', {
		cwd: dir,
		env: { CONFIG_PATH: 'not-the-selected-file.yaml' }
	});
	expect(config.database.app).toBe(join(dir, 'data', 'when.sqlite'));
	expect(config.database.queue).toBe(join(dir, 'data', 'openworkflow.sqlite'));
});

test('a bare CONFIG_PATH keeps data under cwd and uses the supplied interpolation environment', async () => {
	const raw = {
		...validConfig,
		smtp: { ...validConfig.smtp, password: '${SMTP_PASSWORD}' }
	};
	await writeFile(join(dir, 'when.yaml'), stringify(raw));
	const config = await loadConfigFile(undefined, {
		cwd: dir,
		env: { CONFIG_PATH: 'when.yaml', SMTP_PASSWORD: 'context-password' }
	});
	expect(config.smtp.password).toBe('context-password');
	expect(config.database.app).toBe(join(dir, 'data', 'when.sqlite'));
	expect(config.database.queue).toBe(join(dir, 'data', 'openworkflow.sqlite'));
	expect(config.meetings['30-min-chat'].daily_booking_limit).toBeNull();
});

test.for([
	{ app: '/var/lib/when/app.sqlite', queue: '/var/lib/when/jobs.sqlite' },
	{ app: './app.sqlite', queue: './jobs.sqlite' },
	{ app: '', queue: '' }
])('database environment overrides are returned unchanged: %j', async ({ app, queue }) => {
	const path = join(dir, 'config.yaml');
	await writeFile(path, stringify(validConfig));
	const config = await loadConfigFile(path, {
		cwd: dir,
		env: { WHEN_DATABASE_PATH: app, WHEN_QUEUE_DB_PATH: queue }
	});
	expect(config.database).toEqual({ app, queue });
});
