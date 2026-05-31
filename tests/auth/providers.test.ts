import { expect, test } from 'vitest';
import { buildProviders } from '$lib/server/auth/providers';
import { requireAuthSecret } from '$lib/server/auth/secret';
import { validConfig } from '../fixtures/valid-config';
import type { WhenConfiguration } from '$lib/server/config/schema';

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
