import { expect, test } from 'vitest';
import { ConfigError, validateConfig } from '$lib/server/config/load';
import { validConfig } from '../fixtures/valid-config';

function clone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v));
}

test('valid config passes schema validation', () => {
	const cfg = validateConfig(clone(validConfig));
	expect(cfg.user.name).toBe('Jane Doe');
	expect(cfg.event_types[0].id).toBe('30-min-chat');
});

test('missing required top-level field fails', () => {
	const bad = clone(validConfig) as unknown as Record<string, unknown>;
	delete bad.auth;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('auth with neither oidc nor credentials fails', () => {
	const bad = clone(validConfig);
	(bad as { auth: unknown }).auth = {};
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		expect(err).toBeInstanceOf(ConfigError);
		const issues = (err as ConfigError).issues;
		expect(issues.some((i) => i.path.startsWith('/auth'))).toBe(true);
	}
});

test('auth with both oidc and credentials fails oneOf', () => {
	const bad = clone(validConfig);
	(bad as { auth: unknown }).auth = {
		oidc: { issuer: 'https://auth.example.com', client_id: 'a', client_secret: 'b' },
		credentials: { username: 'u', password_hash: 'h' }
	};
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('invalid email format fails', () => {
	const bad = clone(validConfig);
	bad.user.email = 'not-an-email';
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		expect(err).toBeInstanceOf(ConfigError);
		expect((err as ConfigError).issues.some((i) => i.path.includes('/user/email'))).toBe(true);
	}
});

test('invalid time range fails pattern', () => {
	const bad = clone(validConfig);
	bad.availability.default.monday = ['25:00-30:00'];
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('unknown top-level field fails', () => {
	const bad = clone(validConfig) as unknown as Record<string, unknown>;
	bad.rogue = 'not allowed';
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('empty event_types array fails', () => {
	const bad = clone(validConfig);
	bad.event_types = [] as never;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('location mode=fixed requires fixed field', () => {
	const bad = clone(validConfig);
	bad.event_types[0].location = { mode: 'fixed' } as never;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('location mode=fixed accepts fixed value', () => {
	const good = clone(validConfig);
	good.event_types[0].location = { mode: 'fixed', fixed: 'https://meet.example.com/jane' } as never;
	const cfg = validateConfig(good);
	expect(cfg.event_types[0].location).toEqual({
		mode: 'fixed',
		fixed: 'https://meet.example.com/jane'
	});
});

test('env vars are interpolated before validation', () => {
	const raw = clone(validConfig) as unknown as typeof validConfig & {
		auth: { credentials: { password_hash: string } };
	};
	raw.auth = { credentials: { username: 'admin', password_hash: '${ADMIN_HASH}' } };
	// Stash and restore process.env for the test
	const prev = process.env.ADMIN_HASH;
	process.env.ADMIN_HASH = '$argon2id$real-hash';
	try {
		const cfg = validateConfig(raw);
		expect(cfg.auth).toEqual({
			credentials: { username: 'admin', password_hash: '$argon2id$real-hash' }
		});
	} finally {
		if (prev === undefined) delete process.env.ADMIN_HASH;
		else process.env.ADMIN_HASH = prev;
	}
});
