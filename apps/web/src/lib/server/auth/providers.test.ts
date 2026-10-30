import { expect, test } from 'vitest';
import { buildAuthOptions, verifyCredentials } from './providers';
import { requireAuthSecret } from '#lib/server/auth/secret.js';
import { validConfig } from '#lib/server/__fixtures__/valid-config.js';
import type { WhenConfiguration } from '@when/config';

test('credentials config registers only the YAML credentials plugin', () => {
	const options = buildAuthOptions(validConfig);
	expect(options.plugins?.map((plugin) => plugin.id)).toEqual(['when-credentials']);
});

test('oidc config registers only the generic OAuth plugin', () => {
	const cfg: WhenConfiguration = {
		...validConfig,
		url: { ...validConfig.url, app: 'https://when.example.test' },
		auth: {
			oidc: {
				issuer: 'https://auth.example.com',
				client_id: 'when',
				client_secret: 'shh',
				name: 'Single Sign-On'
			}
		}
	};
	const options = buildAuthOptions(cfg);
	expect(options.plugins?.map((plugin) => plugin.id)).toEqual(['generic-oauth']);
});

test('requireAuthSecret rejects missing secret', () => {
	expect(() => requireAuthSecret({})).toThrow(/AUTH_SECRET/);
});

test('requireAuthSecret rejects short secret', () => {
	expect(() => requireAuthSecret({ AUTH_SECRET: 'too-short' })).toThrow();
});

test('requireAuthSecret accepts a 32+ char secret', () => {
	const secret = 'a'.repeat(32);
	expect(requireAuthSecret({ AUTH_SECRET: secret })).toBe(secret);
});

const ADMIN = { username: 'admin', password: 'correct horse' };

test('the configured credentials authorize', () => {
	expect(verifyCredentials(ADMIN, { username: 'admin', password: 'correct horse' })).toMatchObject({
		id: 'admin'
	});
});

test.for([
	['admin', 'wrong horse'],
	['admin', 'x'],
	['admin', ''],
	['admin', 'correct horse!'],
	['nobody', 'correct horse'],
	['', '']
])('%s / %s is rejected without throwing', ([username, password]) => {
	expect(verifyCredentials(ADMIN, { username, password })).toBeNull();
});

test('a multi-byte password neither throws nor authorizes the wrong input', () => {
	const expected = { username: 'admin', password: 'caf\u00e9 \u2615' };

	expect(
		verifyCredentials(expected, { username: 'admin', password: 'caf\u00e9 \u2615' })
	).toMatchObject({
		id: 'admin'
	});
	// Same JS string length, different byte length — a string-length guard would throw here.
	expect(verifyCredentials(expected, { username: 'admin', password: 'cafe x' })).toBeNull();
});

test('missing or non-string fields are rejected', () => {
	expect(verifyCredentials(ADMIN, undefined)).toBeNull();
	expect(verifyCredentials(ADMIN, {})).toBeNull();
	expect(verifyCredentials(ADMIN, { username: 1, password: 2 })).toBeNull();
});
