import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { bootConfig } from './boot';
import { ConfigError } from '@when/config';
import { validConfig } from '#lib/server/__fixtures__/valid-config.js';

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

test('boot uses the supplied file context without relocating bare-filename databases', async () => {
	const raw = {
		...validConfig,
		auth: { credentials: { username: 'admin', password: '${BOOT_PASSWORD}' } }
	};
	await writeFile(join(dir, 'when.yaml'), stringify(raw));
	const cfg = await bootConfig(undefined, {
		cwd: dir,
		env: { CONFIG_PATH: 'when.yaml', BOOT_PASSWORD: 'synthetic-boot-password' }
	});
	expect(cfg.auth.credentials?.password).toBe('synthetic-boot-password');
	expect(cfg.database.app).toBe(join(dir, 'data', 'when.sqlite'));
	expect(cfg.database.queue).toBe(join(dir, 'data', 'openworkflow.sqlite'));
});
