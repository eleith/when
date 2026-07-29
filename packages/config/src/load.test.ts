import { expect, test } from 'vitest';
import { ConfigError, validateConfig, validateStructure } from './load.js';
import { MissingEnvVarsError } from './interpolate.js';
import { validConfig } from './__fixtures__/valid-config.js';
import type { WhenConfiguration } from './schema.js';

function clone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v));
}

test('valid config passes schema validation', () => {
	const cfg = validateConfig(clone(validConfig));
	expect(cfg.user.name).toBe('Jane Doe');
	expect(cfg.meetings[0].name).toBe('30-min-chat');
});

test('validateStructure accepts unset secret env refs that validateConfig rejects', () => {
	const raw = clone(validConfig) as WhenConfiguration;
	raw.auth = { credentials: { username: 'admin', password: '${WHEN_UNSET_PW_TEST}' } };
	const prev = process.env.WHEN_UNSET_PW_TEST;
	delete process.env.WHEN_UNSET_PW_TEST;
	try {
		// full validation interpolates and fails on the missing var...
		expect(() => validateConfig(clone(raw))).toThrow(MissingEnvVarsError);
		// ...but structural validation leaves the ref intact and passes.
		const cfg = validateStructure(clone(raw));
		expect(cfg.auth).toEqual({
			credentials: { username: 'admin', password: '${WHEN_UNSET_PW_TEST}' }
		});
	} finally {
		if (prev === undefined) delete process.env.WHEN_UNSET_PW_TEST;
		else process.env.WHEN_UNSET_PW_TEST = prev;
	}
});

test('validateStructure still rejects a structurally invalid config', () => {
	const bad = clone(validConfig);
	bad.user.email = 'not-an-email';
	expect(() => validateStructure(bad)).toThrow(ConfigError);
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

test('invalid time fails pattern', () => {
	const bad = clone(validConfig);
	bad.schedules[0].weekly[0].from = '25:00';
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test.for([
	'https://cdn.example.com/logo.png',
	'//cdn.example.com/logo.png',
	'/\\evil.com/logo.png',
	'data:image/svg+xml,<svg/>',
	'logo.png'
])('an appearance asset outside this origin fails: %s', (value) => {
	const bad = clone(validConfig);
	bad.user.appearance.avatar_url = value;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('a root-relative appearance asset passes', () => {
	const cfg = clone(validConfig);
	cfg.user.appearance.avatar_url = '/public/avatar.png';
	expect(validateConfig(cfg).user.appearance.avatar_url).toBe('/public/avatar.png');
});

test('unknown top-level field fails', () => {
	const bad = clone(validConfig) as unknown as Record<string, unknown>;
	bad.rogue = 'not allowed';
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('empty meetings array fails', () => {
	const bad = clone(validConfig);
	bad.meetings = [] as never;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('location accepts string value', () => {
	const good = clone(validConfig);
	good.meetings[0].location = 'Meeting Room A';
	const cfg = validateConfig(good);
	expect(cfg.meetings[0].location).toBe('Meeting Room A');
});

test('location rejects non-string value', () => {
	const bad = clone(validConfig);
	bad.meetings[0].location = 123 as never;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('video_chat_service accepts valid service name', () => {
	const good = clone(validConfig);
	good.meetings[0].video_chat_service = 'google-service';
	const cfg = validateConfig(good);
	expect(cfg.meetings[0].video_chat_service).toBe('google-service');
});

test('video_chat_service rejects non-string value', () => {
	const bad = clone(validConfig);
	bad.meetings[0].video_chat_service = 123 as never;
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

test('smtp.port defaults to 587 when omitted', () => {
	const raw = clone(validConfig) as unknown as { smtp: { port?: number } };
	delete raw.smtp.port;
	expect(validateConfig(raw).smtp.port).toBe(587);
});

test('meeting duration_minutes defaults to 30 when omitted', () => {
	const raw = clone(validConfig) as unknown as { meetings: { duration_minutes?: number }[] };
	delete raw.meetings[0].duration_minutes;
	expect(validateConfig(raw).meetings[0].duration_minutes).toBe(30);
});

test('meeting duration_minutes accepts a list of lengths', () => {
	const raw = clone(validConfig) as unknown as {
		meetings: { duration_minutes: number | number[] }[];
	};
	raw.meetings[0].duration_minutes = [15, 30, 60];
	expect(validateConfig(raw).meetings[0].duration_minutes).toEqual([15, 30, 60]);
});

test('meeting duration_minutes rejects an empty list', () => {
	const bad = clone(validConfig) as unknown as {
		meetings: { duration_minutes: number | number[] }[];
	};
	bad.meetings[0].duration_minutes = [];
	expect(() => validateConfig(bad)).toThrow();
});

test('meeting booking_approval defaults to request when omitted', () => {
	const raw = clone(validConfig) as unknown as { meetings: { booking_approval?: string }[] };
	delete raw.meetings[0].booking_approval;
	expect(validateConfig(raw).meetings[0].booking_approval).toBe('request');
});

test('user timezone defaults to the TZ env var when omitted', () => {
	const raw = clone(validConfig) as unknown as { user: { timezone?: string } };
	delete raw.user.timezone;
	const prev = process.env.TZ;
	process.env.TZ = 'America/Chicago';
	try {
		expect(validateConfig(raw).user.timezone).toBe('America/Chicago');
	} finally {
		if (prev === undefined) delete process.env.TZ;
		else process.env.TZ = prev;
	}
});

test('user timezone defaults to UTC when omitted and TZ is unset', () => {
	const raw = clone(validConfig) as unknown as { user: { timezone?: string } };
	delete raw.user.timezone;
	const prev = process.env.TZ;
	delete process.env.TZ;
	try {
		expect(validateConfig(raw).user.timezone).toBe('UTC');
	} finally {
		if (prev === undefined) delete process.env.TZ;
		else process.env.TZ = prev;
	}
});

test('meeting slug is derived from the name when omitted', () => {
	const raw = clone(validConfig) as unknown as { meetings: { name: string; slug?: string }[] };
	raw.meetings[0].name = 'Quick Intro Call';
	delete raw.meetings[0].slug;
	expect(validateConfig(raw).meetings[0].slug).toBe('quick-intro-call');
});

test('meeting schedule and booking_calendar default to the first when omitted', () => {
	const raw = clone(validConfig) as unknown as {
		meetings: { schedule?: string; booking_calendar?: string }[];
	};
	delete raw.meetings[0].schedule;
	delete raw.meetings[0].booking_calendar;
	const cfg = validateConfig(raw);
	expect(cfg.meetings[0].schedule).toBe('standard');
	expect(cfg.meetings[0].booking_calendar).toBe('my-google-cal');
});

test('omitted schedule with multiple schedules defaults to the first', () => {
	const raw = clone(validConfig) as unknown as {
		schedules: { name: string; weekly: unknown }[];
		meetings: { schedule?: string }[];
	};
	raw.schedules.push({ name: 'weekend', weekly: [{ days: ['sat'], from: '10:00', to: '14:00' }] });
	delete raw.meetings[0].schedule;
	expect(validateConfig(raw).meetings[0].schedule).toBe('standard');
});

test('schedule weekly defaults to Monday-Friday business hours when omitted', () => {
	const raw = clone(validConfig) as unknown as { schedules: { weekly?: unknown }[] };
	delete raw.schedules[0].weekly;
	expect(validateConfig(raw).schedules[0].weekly).toEqual([
		{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }
	]);
});

test('schedule with no time windows fails validation', () => {
	const bad = clone(validConfig);
	bad.schedules[0].weekly = [];
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		expect(err).toBeInstanceOf(ConfigError);
		expect((err as ConfigError).issues.some((issue) => issue.path === '/schedules/0/weekly')).toBe(
			true
		);
	}
});

test('meeting note accepts valid string note', () => {
	const good = clone(validConfig);
	good.meetings[0].note = 'Please read the notes before scheduling.';
	const cfg = validateConfig(good);
	expect(cfg.meetings[0].note).toBe('Please read the notes before scheduling.');
});

test('meeting note with empty string fails validation', () => {
	const bad = clone(validConfig);
	bad.meetings[0].note = '' as never;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});
