import { expect, test } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import {
	ConfigError,
	loadConfigFile,
	loadConfigFileStructure,
	validateConfig,
	validateStructure
} from './load.js';
import { MissingEnvVarsError } from './interpolate.js';
import { validConfig } from './__fixtures__/valid-config.js';
import type { WhenConfiguration } from './schema.js';

function clone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v));
}

test('malformed YAML reports its position without echoing an inline password', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'when-config-redaction-'));
	const path = join(directory, 'when.yaml');
	const secret = 'SYNTHETIC_PRIVATE_PASSWORD_SENTINEL';
	try {
		await writeFile(path, `auth:\n  credentials:\n    password: "${secret}\n`);
		let failure: unknown;
		try {
			await loadConfigFile(path);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(ConfigError);
		expect(String(failure)).toMatch(/invalid YAML syntax at line \d+, column \d+ \(MISSING_CHAR\)/);
		expect(String(failure)).not.toContain(secret);
		expect(JSON.stringify((failure as ConfigError).issues)).not.toContain(secret);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

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
	expect(() => validateConfig(raw, { env: {} })).toThrow(MissingEnvVarsError);
	const cfg = validateStructure(raw);
	expect(cfg.auth).toEqual({
		credentials: { username: 'admin', password: '${WHEN_UNSET_PW_TEST}' }
	});
});

test('structural file loading uses context for selection, not interpolation or database overrides', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'when-config-structure-'));
	const raw = {
		...validConfig,
		auth: { credentials: { username: 'admin', password: '${WHEN_ADMIN_PASSWORD}' } },
		database: { app: '${DB_PATH}', queue: './jobs.sqlite' }
	};
	const options = {
		cwd: directory,
		env: {
			CONFIG_PATH: 'config/when.yaml',
			WHEN_ADMIN_PASSWORD: 'context-password',
			DB_PATH: './resolved.sqlite',
			WHEN_DATABASE_PATH: '/override.sqlite',
			WHEN_QUEUE_DB_PATH: '/override-jobs.sqlite'
		}
	};
	try {
		await mkdir(join(directory, 'config'));
		await writeFile(join(directory, 'config', 'when.yaml'), stringify(raw));
		const structural = await loadConfigFileStructure(undefined, options);
		expect(structural.auth.credentials?.password).toBe('${WHEN_ADMIN_PASSWORD}');
		expect(structural.database).toEqual(raw.database);
		const runtime = await loadConfigFile(undefined, options);
		expect(runtime.auth.credentials?.password).toBe('context-password');
		expect(runtime.database).toEqual({
			app: '/override.sqlite',
			queue: '/override-jobs.sqlite'
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
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

test('oidc auth defaults name to Single Sign-On when omitted', () => {
	const cfg = clone(validConfig);
	(cfg as { auth: unknown }).auth = {
		oidc: { issuer: 'https://auth.example.com', client_id: 'a', client_secret: 'b' }
	};
	const loaded = validateConfig(cfg);
	expect(loaded.auth.oidc?.name).toBe('Single Sign-On');
});

test('oidc auth preserves custom name override', () => {
	const cfg = clone(validConfig);
	(cfg as { auth: unknown }).auth = {
		oidc: {
			issuer: 'https://auth.example.com',
			client_id: 'a',
			client_secret: 'b',
			name: 'Authelia'
		}
	};
	const loaded = validateConfig(cfg);
	expect(loaded.auth.oidc?.name).toBe('Authelia');
});

test.for<WhenConfiguration['auth']>([
	validConfig.auth,
	{
		oidc: {
			issuer: 'https://auth.example.com',
			client_id: 'when',
			client_secret: 'test',
			name: 'SSO'
		}
	}
])('either auth strategy accepts an optional persistent session secret', (auth) => {
	const raw = { ...clone(validConfig), auth };
	expect(validateConfig(raw).auth.secret).toBeUndefined();
	const secret = 'a'.repeat(32);
	expect(validateConfig({ ...raw, auth: { ...auth, secret } }).auth.secret).toBe(secret);
});

test('structural session-secret references stay unresolved; runtime checks the resolved length', () => {
	const raw = { ...clone(validConfig), auth: { ...validConfig.auth, secret: '${AUTH_SECRET}' } };
	expect(validateStructure(raw).auth.secret).toBe('${AUTH_SECRET}');
	expect(() => validateConfig(raw, { env: {} })).toThrow(MissingEnvVarsError);
	const secret = 'a'.repeat(32);
	expect(validateConfig(raw, { env: { AUTH_SECRET: secret } }).auth.secret).toBe(secret);
	for (const value of ['', 'a'.repeat(31)]) {
		expect(() => validateConfig(raw, { env: { AUTH_SECRET: value } })).toThrow(ConfigError);
	}
});

test('short literal session-secret errors identify the field without exposing its value', () => {
	const secret = 'private-short-session-key';
	const raw = { ...clone(validConfig), auth: { ...validConfig.auth, secret } };
	expect(validateStructure(raw).auth.secret).toBe(secret);
	try {
		validateConfig(raw);
		throw new Error('expected ConfigError');
	} catch (error) {
		expect(error).toBeInstanceOf(ConfigError);
		expect((error as ConfigError).issues).toEqual([
			{
				path: '/auth/secret',
				message: 'must contain at least 32 characters after environment interpolation'
			}
		]);
		expect(String(error)).not.toContain(secret);
		expect(JSON.stringify((error as ConfigError).issues)).not.toContain(secret);
	}
});

test.for(['', null, 32])('an empty or non-string session secret is rejected: %s', (secret) => {
	const raw = { ...clone(validConfig), auth: { ...validConfig.auth, secret } };
	expect(() => validateStructure(raw)).toThrow(ConfigError);
	expect(() => validateConfig(raw)).toThrow(ConfigError);
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
	bad.user.appearance.avatar_path = value;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('a root-relative appearance asset passes', () => {
	const cfg = clone(validConfig);
	cfg.user.appearance.avatar_path = '/public/avatar.png';
	expect(validateConfig(cfg).user.appearance.avatar_path).toBe('/public/avatar.png');
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

test('video_chat accepts valid config and defaults attach.auto to true', () => {
	const good = clone(validConfig);
	good.meetings['30-min-chat'].video_chat = { provider: 'google-service' };
	const cfg = validateConfig(good);
	expect(cfg.meetings['30-min-chat'].video_chat?.provider).toBe('google-service');
	expect(cfg.meetings['30-min-chat'].video_chat?.attach).toEqual({ auto: true });
});

test('video_chat accepts explicit attach.auto: false', () => {
	const good = clone(validConfig);
	good.meetings['30-min-chat'].video_chat = { provider: 'google-service', attach: { auto: false } };
	const cfg = validateConfig(good);
	expect(cfg.meetings['30-min-chat'].video_chat?.attach).toEqual({ auto: false });
});

test('video_chat accepts valid attach.when condition', () => {
	const good = clone(validConfig);
	good.meetings['30-min-chat'].form_fields = [
		{ name: 'guest_name', label: 'Name', type: 'guest_name', required: true },
		{
			name: 'channel',
			label: 'Channel',
			type: 'choice',
			choices: ['in-person', 'video'],
			required: false
		}
	];
	good.meetings['30-min-chat'].video_chat = {
		provider: 'google-service',
		attach: {
			when: [{ field: 'channel', equals: 'video' }]
		}
	};
	const cfg = validateConfig(good);
	expect(cfg.meetings['30-min-chat'].video_chat?.attach).toEqual({
		when: [{ field: 'channel', equals: 'video' }]
	});
});

test('video_chat rejects invalid value', () => {
	const bad = clone(validConfig);
	bad.meetings['30-min-chat'].video_chat = 123 as never;
	expect(() => validateConfig(bad)).toThrow(ConfigError);
});

test('env vars are interpolated before validation', () => {
	const raw = clone(validConfig) as WhenConfiguration;
	raw.auth = { credentials: { username: 'admin', password: '${ADMIN_PW_TEST}' } };
	const cfg = validateConfig(raw, { env: { ADMIN_PW_TEST: 'real-password' } });
	expect(cfg.auth).toEqual({
		credentials: { username: 'admin', password: 'real-password' }
	});
});

test('password defaults to WHEN_ADMIN_PASSWORD if omitted', () => {
	const raw = clone(validConfig) as unknown as { auth: { credentials: { password?: string } } };
	delete raw.auth.credentials.password;
	const cfg = validateConfig(raw, { env: { WHEN_ADMIN_PASSWORD: 'defaulted-password' } });
	expect(cfg.auth).toEqual({
		credentials: { username: 'admin', password: 'defaulted-password' }
	});
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
	expect(validateConfig(raw, { env: { TZ: 'America/Chicago' } }).user.timezone).toBe(
		'America/Chicago'
	);
});

test('user timezone defaults to UTC when omitted and TZ is unset', () => {
	const raw = clone(validConfig) as unknown as { user: { timezone?: string } };
	delete raw.user.timezone;
	expect(validateConfig(raw, { env: {} }).user.timezone).toBe('UTC');
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
