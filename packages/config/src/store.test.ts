import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import {
	loadConfig,
	reloadConfig,
	watchConfig,
	configChanged,
	type ReloadResult
} from './store.js';
import { validConfig } from './__fixtures__/valid-config.js';

let dir: string;
let path: string;
const stops: Array<() => void> = [];

function renamed(name: string): typeof validConfig {
	return { ...validConfig, user: { ...validConfig.user, name } };
}

async function write(config: unknown): Promise<void> {
	await writeFile(path, stringify(config));
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'when-store-'));
	path = join(dir, 'config.yaml');
	await write(validConfig);
});

afterEach(async () => {
	while (stops.length) stops.pop()?.();
	await rm(dir, { recursive: true, force: true });
});

test('loadConfig returns the cached config for the same path', async () => {
	const first = await loadConfig(path);
	await write(renamed('Changed')); // a cached loader must not observe this
	const second = await loadConfig(path);
	expect(second).toBe(first);
	expect(second.user.name).toBe(validConfig.user.name);
});

test('reloadConfig picks up a valid change and swaps the cache', async () => {
	await loadConfig(path);
	await write(renamed('Renamed'));
	const result = await reloadConfig();
	expect(result.ok).toBe(true);
	if (result.ok) expect(result.config.user.name).toBe('Renamed');
	const cached = await loadConfig(path);
	expect(cached.user.name).toBe('Renamed');
});

test('reloadConfig keeps the current config when the new file is invalid', async () => {
	const good = await loadConfig(path);
	await write({}); // valid YAML, fails schema (missing required top-level keys)
	const result = await reloadConfig();
	expect(result.ok).toBe(false);
	const cached = await loadConfig(path);
	expect(cached).toBe(good);
});

test('watchConfig invokes the callback with a reload result on change', async () => {
	await loadConfig(path);
	const results: ReloadResult[] = [];
	stops.push(watchConfig((r) => results.push(r)));
	await write(renamed('Watched'));
	await vi.waitFor(() => expect(results.length).toBeGreaterThan(0), {
		timeout: 5000,
		interval: 200
	});
	const last = results.at(-1);
	expect(last?.ok).toBe(true);
	if (last?.ok) expect(last.config.user.name).toBe('Watched');
});

test('configChanged flags a changed subtree and ignores key order', () => {
	const changedSmtp = { ...validConfig, smtp: { ...validConfig.smtp, host: 'new.example.com' } };
	expect(configChanged(validConfig, changedSmtp, ['smtp'])).toBe(true);
	expect(configChanged(validConfig, changedSmtp, ['auth'])).toBe(false);

	const reordered = {
		...validConfig,
		smtp: { pass: 'secret', user: 'mailer', port: 587, host: 'smtp.example.com' }
	};
	expect(configChanged(validConfig, reordered, ['smtp'])).toBe(false);
});
