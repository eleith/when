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
	delete process.env.CONFIG_PATH;
	dir = await mkdtemp(join(tmpdir(), 'when-paths-'));
	process.chdir(dir);
});

afterEach(async () => {
	process.chdir(savedCwd);
	process.env = { ...savedEnv };
	await rm(dir, { recursive: true, force: true });
});

test('CONFIG_PATH overrides everything', () => {
	process.env.CONFIG_PATH = '/custom/where.yaml';
	process.env.NODE_ENV = 'production';
	expect(resolveConfigPath()).toBe('/custom/where.yaml');
});

test('production defaults to the container config path', () => {
	process.env.NODE_ENV = 'production';
	expect(resolveConfigPath()).toBe('/app/config/when.yaml');
});

test('dev uses config/when.yaml in the cwd when present', async () => {
	await mkdir(join(dir, 'config'), { recursive: true });
	await writeFile(join(dir, 'config', 'when.yaml'), '');
	expect(resolveConfigPath()).toBe(join(dir, 'config', 'when.yaml'));
});

test('dev falls back to the monorepo root config/when.yaml', async () => {
	await mkdir(join(dir, 'config'), { recursive: true });
	await writeFile(join(dir, 'config', 'when.yaml'), '');
	const cwd = join(dir, 'apps', 'web');
	await mkdir(cwd, { recursive: true });
	process.chdir(cwd);
	expect(resolveConfigPath()).toBe(join(dir, 'config', 'when.yaml'));
});

test('dev falls back to cwd config/when.yaml when nothing exists', () => {
	expect(resolveConfigPath()).toBe(join(dir, 'config', 'when.yaml'));
});
