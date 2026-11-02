import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfigPath, resolveDeploymentRoot, resolvePublicDir } from './paths.js';

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'when-paths-'));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

test.for(['/custom/where.yaml', 'when.yaml'])('CONFIG_PATH overrides everything: %s', (path) => {
	const options = { cwd: dir, env: { CONFIG_PATH: path, NODE_ENV: 'production' } };
	expect(resolveConfigPath(options)).toBe(path);
});

test('production defaults to the container config path', () => {
	expect(resolveConfigPath({ cwd: dir, env: { NODE_ENV: 'production' } })).toBe(
		'/app/config/when.yaml'
	);
});

test('dev uses config/when.yaml in the supplied cwd when present', async () => {
	await mkdir(join(dir, 'config'), { recursive: true });
	await writeFile(join(dir, 'config', 'when.yaml'), '');
	expect(resolveConfigPath({ cwd: dir, env: {} })).toBe(join(dir, 'config', 'when.yaml'));
});

test('dev falls back to the monorepo root config/when.yaml', async () => {
	await mkdir(join(dir, 'config'), { recursive: true });
	await writeFile(join(dir, 'config', 'when.yaml'), '');
	const cwd = join(dir, 'apps', 'web');
	await mkdir(cwd, { recursive: true });
	expect(resolveConfigPath({ cwd, env: {} })).toBe(join(dir, 'config', 'when.yaml'));
});

test('dev falls back to cwd config/when.yaml when nothing exists', () => {
	expect(resolveConfigPath({ cwd: dir, env: {} })).toBe(join(dir, 'config', 'when.yaml'));
});

test('resolveDeploymentRoot is the config directory parent', () => {
	expect(resolveDeploymentRoot('/srv/when/config/when.yaml')).toBe('/srv/when');
});

test.for(['/srv/when/config/when.yaml', 'config/when.yaml', 'when.yaml'])(
	'public defaults stay under the deployment root for selected path %s',
	(path) => {
		const options = { cwd: '/srv/when', env: { CONFIG_PATH: path } };
		expect(resolvePublicDir(undefined, options)).toBe('/srv/when/public');
		expect(resolvePublicDir(resolveConfigPath(options), options)).toBe('/srv/when/public');
	}
);

test.for(['/var/lib/when/public', './custom-public', ''])(
	'WHEN_PUBLIC_DIR overrides the resolved public dir without normalization: %s',
	(publicDir) => {
		expect(
			resolvePublicDir('/srv/when/config/when.yaml', {
				cwd: dir,
				env: { WHEN_PUBLIC_DIR: publicDir }
			})
		).toBe(publicDir);
	}
);
