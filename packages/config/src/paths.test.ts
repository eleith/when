import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfigPath } from './paths.js';

const savedEnv = { ...process.env };
const savedCwd = process.cwd();
let dir: string;

beforeEach(async () => {
	delete process.env.NODE_ENV;
	dir = await mkdtemp(join(tmpdir(), 'when-paths-'));
	process.chdir(dir);
});

afterEach(async () => {
	process.chdir(savedCwd);
	process.env = { ...savedEnv };
	await rm(dir, { recursive: true, force: true });
});

test('production defaults to the container config path', () => {
	process.env.NODE_ENV = 'production';
	expect(resolveConfigPath()).toBe('/app/config.yaml');
});

test('dev uses config.yaml in the cwd when present', async () => {
	await writeFile(join(dir, 'config.yaml'), '');
	expect(resolveConfigPath()).toBe(join(dir, 'config.yaml'));
});

test('dev falls back to the monorepo root config.yaml', async () => {
	await writeFile(join(dir, 'config.yaml'), '');
	const cwd = join(dir, 'apps', 'web');
	await mkdir(cwd, { recursive: true });
	process.chdir(cwd);
	expect(resolveConfigPath()).toBe(join(dir, 'config.yaml'));
});

test('dev falls back to cwd config.yaml when nothing exists', () => {
	expect(resolveConfigPath()).toBe(join(dir, 'config.yaml'));
});
