import { afterEach, beforeEach, expect, test } from 'vitest';
import { join } from 'node:path';
import { resolveConfigPath } from './paths';

const saved = { ...process.env };

beforeEach(() => {
	delete process.env.NODE_ENV;
	delete process.env.CONFIG_PATH;
});

afterEach(() => {
	process.env = { ...saved };
});

test('CONFIG_PATH takes precedence', () => {
	process.env.CONFIG_PATH = '/etc/when/config.yaml';
	expect(resolveConfigPath()).toBe('/etc/when/config.yaml');
});

test('production defaults to the container config path', () => {
	process.env.NODE_ENV = 'production';
	expect(resolveConfigPath()).toBe('/app/config.yaml');
});

test('dev defaults to config.yaml in the cwd', () => {
	expect(resolveConfigPath()).toBe(join(process.cwd(), 'config.yaml'));
});
