import { expect, test, vi } from 'vitest';
import { buildProviders, verifyCredentials } from './providers';
import { requireAuthSecret } from '$lib/server/auth/secret';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import type { WhenConfiguration } from '@when/config';
import { logger } from '$lib/server/logger';

test('credentials config produces a single Credentials provider', () => {
	const providers = buildProviders(validConfig);
	expect(providers).toHaveLength(1);
});

test('oidc config produces a single OIDC provider', () => {
	const cfg: WhenConfiguration = {
		...validConfig,
		auth: {
			oidc: {
				issuer: 'https://auth.example.com',
				client_id: 'when',
				client_secret: 'shh'
			}
		}
	};
	const providers = buildProviders(cfg);
	expect(providers).toHaveLength(1);
	const p = providers[0] as Record<string, unknown>;
	expect(p.id).toBe('oidc');
	expect(p.type).toBe('oidc');
	expect(p.issuer).toBe('https://auth.example.com');
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

function warningsWhileBuilding(env: string, auth: WhenConfiguration['auth']): string[] {
	const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
	const previous = process.env.NODE_ENV;
	process.env.NODE_ENV = env;
	try {
		buildProviders({ ...validConfig, auth });
		return warn.mock.calls.map((call) => JSON.stringify(call));
	} finally {
		process.env.NODE_ENV = previous;
		warn.mockRestore();
	}
}

const OIDC = {
	oidc: { issuer: 'https://auth.example.com', client_id: 'when', client_secret: 'shh' }
};

test('credentials auth in production warns about the missing rate limiting', () => {
	expect(warningsWhileBuilding('production', validConfig.auth).join(' ')).toContain(
		'rate limiting'
	);
});

test('credentials auth outside production says nothing', () => {
	expect(warningsWhileBuilding('development', validConfig.auth)).toEqual([]);
});

test('oidc in production says nothing', () => {
	expect(warningsWhileBuilding('production', OIDC)).toEqual([]);
});
