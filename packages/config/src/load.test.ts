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
	expect(cfg.meetings['30-min-chat'].title).toBe('30 minute chat');
});

test('a config that omits version still loads, defaulted to 1', () => {
	const raw = clone(validConfig) as unknown as Record<string, unknown>;
	delete raw.version;
	expect(validateConfig(raw).version).toBe(1);
});

test('an unknown version is rejected', () => {
	const bad = clone(validConfig) as unknown as Record<string, unknown>;
	bad.version = 2;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
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
	bad.schedules.standard.weekly[0].from = '25:00';
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
	good.meetings['30-min-chat'].location = 'Meeting Room A';
	const cfg = validateConfig(good);
	expect(cfg.meetings['30-min-chat'].location).toBe('Meeting Room A');
});

test('location rejects non-string value', () => {
	const bad = clone(validConfig);
	bad.meetings['30-min-chat'].location = 123 as never;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('video_chat_service accepts valid service name', () => {
	const good = clone(validConfig);
	good.meetings['30-min-chat'].video_chat_provider = 'google-service';
	const cfg = validateConfig(good);
	expect(cfg.meetings['30-min-chat'].video_chat_provider).toBe('google-service');
});

test('video_chat_service rejects non-string value', () => {
	const bad = clone(validConfig);
	bad.meetings['30-min-chat'].video_chat_provider = 123 as never;
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
	const raw = clone(validConfig) as unknown as {
		meetings: Record<string, { duration_minutes?: number }>;
	};
	delete raw.meetings['30-min-chat'].duration_minutes;
	expect(validateConfig(raw).meetings['30-min-chat'].duration_minutes).toBe(30);
});

test('a meeting offers further lengths through additional_duration_minutes', () => {
	const raw = clone(validConfig) as unknown as {
		meetings: Record<string, { duration_minutes: number; additional_duration_minutes: number[] }>;
	};
	raw.meetings['30-min-chat'].duration_minutes = 15;
	raw.meetings['30-min-chat'].additional_duration_minutes = [30, 60];
	const meeting = validateConfig(raw).meetings['30-min-chat'];
	expect(meeting.duration_minutes).toBe(15);
	expect(meeting.additional_duration_minutes).toEqual([30, 60]);
});

test('additional_duration_minutes defaults to an empty list', () => {
	const raw = clone(validConfig) as unknown as {
		meetings: Record<string, { additional_duration_minutes?: number[] }>;
	};
	delete raw.meetings['30-min-chat'].additional_duration_minutes;
	expect(validateConfig(raw).meetings['30-min-chat'].additional_duration_minutes).toEqual([]);
});

test('meeting require_approval defaults to true when omitted', () => {
	const raw = clone(validConfig) as unknown as {
		meetings: Record<string, { require_approval?: boolean }>;
	};
	delete raw.meetings['30-min-chat'].require_approval;
	expect(validateConfig(raw).meetings['30-min-chat'].require_approval).toBe(true);
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

test('a meeting must name its schedule and booking_calendar', () => {
	const raw = clone(validConfig) as unknown as {
		meetings: Record<string, { schedule?: string; booking_calendar?: string }>;
	};
	delete raw.meetings['30-min-chat'].schedule;
	delete raw.meetings['30-min-chat'].booking_calendar;
	expect(() => validateConfig(raw)).toThrow(ConfigError);
});

test('schedule weekly defaults to Monday-Friday business hours when omitted', () => {
	const raw = clone(validConfig) as unknown as { schedules: Record<string, { weekly?: unknown }> };
	delete raw.schedules.standard.weekly;
	expect(validateConfig(raw).schedules.standard.weekly).toEqual([
		{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }
	]);
});

test('schedule with no time windows fails validation', () => {
	const bad = clone(validConfig);
	bad.schedules.standard.weekly = [];
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		expect(err).toBeInstanceOf(ConfigError);
		expect(
			(err as ConfigError).issues.some((issue) => issue.path === '/schedules/standard/weekly')
		).toBe(true);
	}
});

test('meeting note accepts valid string note', () => {
	const good = clone(validConfig);
	good.meetings['30-min-chat'].note = 'Please read the notes before scheduling.';
	const cfg = validateConfig(good);
	expect(cfg.meetings['30-min-chat'].note).toBe('Please read the notes before scheduling.');
});

test('meeting note with empty string fails validation', () => {
	const bad = clone(validConfig);
	bad.meetings['30-min-chat'].note = '' as never;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

function withHref(href: string) {
	const raw = clone(validConfig) as unknown as Record<string, unknown>;
	raw.providers = {
		dav: {
			type: 'caldav',
			url: 'https://cal.example.com/dav/',
			username: 'u',
			password: 'p',
			calendars: { 'my-google-cal': { href } }
		}
	};
	return raw;
}

test.for(['calendars/you/main/', '/calendars/you/main/', 'https://cal.example.com/x/'])(
	'a calendar href accepts %s',
	(href) => {
		expect(() => validateConfig(withHref(href))).not.toThrow();
	}
);

test.for(['htps://cal.example.com/x/', '//cal.example.com/x/', 'has space/'])(
	'a calendar href rejects %s',
	(href) => {
		expect(() => validateConfig(withHref(href))).toThrow(ConfigError);
	}
);
