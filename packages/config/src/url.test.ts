import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { loadConfigFile } from './load.js';
import { validConfig } from './__fixtures__/valid-config.js';

let dir: string;
const saved = { ...process.env };

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'when-config-'));
	delete process.env.WHEN_URL_INTERNAL;
});

afterEach(async () => {
	process.env = { ...saved };
	await rm(dir, { recursive: true, force: true });
});

async function load(cfg: unknown) {
	const path = join(dir, 'config.yaml');
	await writeFile(path, stringify(cfg));
	return loadConfigFile(path);
}

test('url.internal defaults to WHEN_URL_INTERNAL when omitted', async () => {
	process.env.WHEN_URL_INTERNAL = 'http://when-app:3000';
	const config = await load({ ...validConfig, url: { app: validConfig.url.app } });
	expect(config.url.internal).toBe('http://when-app:3000');
});

test('an explicit url.internal wins over WHEN_URL_INTERNAL', async () => {
	process.env.WHEN_URL_INTERNAL = 'http://when-app:3000';
	const config = await load({
		...validConfig,
		url: { app: validConfig.url.app, internal: 'http://custom:9999' }
	});
	expect(config.url.internal).toBe('http://custom:9999');
});

test('url.internal is empty when omitted with no env (worker falls back to url.app)', async () => {
	const config = await load({ ...validConfig, url: { app: validConfig.url.app } });
	expect(config.url.internal).toBe('');
});
