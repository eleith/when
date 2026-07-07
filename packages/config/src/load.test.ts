import { expect, test } from 'vitest';
import { ConfigError, validateConfig } from './load.js';
import { validConfig } from './__fixtures__/valid-config.js';
import type { WhenConfiguration } from './schema.js';

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
		credentials: { username: 'u', password: 'h' }
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
	bad.availabilities[0].weekly.monday = ['25:00-30:00'];
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

test('location accepts string value', () => {
	const good = clone(validConfig);
	good.event_types[0].location = 'Meeting Room A';
	const cfg = validateConfig(good);
	expect(cfg.event_types[0].location).toBe('Meeting Room A');
});

test('location rejects non-string value', () => {
	const bad = clone(validConfig);
	bad.event_types[0].location = 123 as never;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('video_chat accepts valid string', () => {
	const good = clone(validConfig);
	good.event_types[0].video_chat = 'google-service'; // must be a valid reference in fixture to pass cross-refs
	// Wait, validConfig has services[0].id === 'google-service' but not video_chats.
	// In cross-refs, if it's not a URL, it checks if it exists in video_chats.
	// Let's use a URL (e.g. 'https://meet.google.com/abc') so it doesn't fail cross-refs.
	good.event_types[0].video_chat = 'https://meet.google.com/abc';
	const cfg = validateConfig(good);
	expect(cfg.event_types[0].video_chat).toBe('https://meet.google.com/abc');
});

test('video_chat rejects non-string value', () => {
	const bad = clone(validConfig);
	bad.event_types[0].video_chat = 123 as never;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('env vars are interpolated before validation', () => {
	const raw = clone(validConfig) as WhenConfiguration;
	raw.auth = { credentials: { username: 'admin', password: '${ADMIN_PW_TEST}' } };
	// Stash and restore process.env for the test
	const prev = process.env.ADMIN_PW_TEST;
	process.env.ADMIN_PW_TEST = 'real-password';
	try {
		const cfg = validateConfig(raw);
		expect(cfg.auth).toEqual({
			credentials: { username: 'admin', password: 'real-password' }
		});
	} finally {
		if (prev === undefined) delete process.env.ADMIN_PW_TEST;
		else process.env.ADMIN_PW_TEST = prev;
	}
});

test('password defaults to WHEN_ADMIN_PASSWORD if omitted', () => {
	const raw = clone(validConfig) as unknown as { auth: { credentials: { password?: string } } };
	delete raw.auth.credentials.password;
	const prev = process.env.WHEN_ADMIN_PASSWORD;
	process.env.WHEN_ADMIN_PASSWORD = 'defaulted-password';
	try {
		const cfg = validateConfig(raw);
		expect(cfg.auth).toEqual({
			credentials: { username: 'admin', password: 'defaulted-password' }
		});
	} finally {
		if (prev === undefined) delete process.env.WHEN_ADMIN_PASSWORD;
		else process.env.WHEN_ADMIN_PASSWORD = prev;
	}
});

test('event_type note accepts valid string note', () => {
	const good = clone(validConfig);
	good.event_types[0].note = 'Please read the notes before scheduling.';
	const cfg = validateConfig(good);
	expect(cfg.event_types[0].note).toBe('Please read the notes before scheduling.');
});

test('event_type note with empty string fails validation', () => {
	const bad = clone(validConfig);
	bad.event_types[0].note = '' as never;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});
