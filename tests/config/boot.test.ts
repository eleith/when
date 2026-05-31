import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { bootConfig } from '$lib/server/config/boot';
import { ConfigError } from '$lib/server/config/load';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'when-boot-'));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

test('missing config throws', async () => {
	const cfgPath = join(dir, 'config.yaml');
	await expect(bootConfig(cfgPath)).rejects.toThrow(/config not found/);
});

test('invalid config throws ConfigError', async () => {
	const cfgPath = join(dir, 'config.yaml');
	await writeFile(cfgPath, 'auth: {}\nuser: {}\n');
	await expect(bootConfig(cfgPath)).rejects.toBeInstanceOf(ConfigError);
});

test('valid config loads and returns typed object', async () => {
	const cfgPath = join(dir, 'config.yaml');
	await writeFile(cfgPath, stringify(validConfig));
	const cfg = await bootConfig(cfgPath);
	expect(cfg.user.name).toBe('Jane Doe');
	expect(cfg.event_types[0].slug).toBe('30-min');
});
