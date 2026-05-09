import { expect, test } from 'bun:test';
import { ConfigError, validateConfig } from '../../src/lib/server/config/load';
import { validConfig } from '../fixtures/valid-config';

function clone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v));
}

test('valid cross-refs pass', () => {
	expect(() => validateConfig(clone(validConfig))).not.toThrow();
});

test('unknown destination_calendar flagged', () => {
	const bad = clone(validConfig);
	bad.event_types[0].destination_calendar = 'does-not-exist';
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		expect(err).toBeInstanceOf(ConfigError);
		const issues = (err as ConfigError).issues;
		expect(issues[0].path).toBe('/event_types/0/destination_calendar');
		expect(issues[0].message).toContain('does-not-exist');
	}
});

test('unknown conflict_calendars entry flagged with index', () => {
	const bad = clone(validConfig);
	bad.event_types[0].conflict_calendars = ['my-google-cal', 'missing-cal'];
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		const issues = (err as ConfigError).issues;
		expect(issues.some((i) => i.path === '/event_types/0/conflict_calendars/1')).toBe(true);
	}
});

test('requires_confirmation without smtp flagged', () => {
	const bad = clone(validConfig);
	bad.event_types[0].booking_flow = 'requires_confirmation';
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		const issues = (err as ConfigError).issues;
		expect(issues[0].path).toBe('/event_types/0/booking_flow');
		expect(issues[0].message).toContain('smtp');
	}
});

test('requires_confirmation with smtp passes', () => {
	const good = clone(validConfig);
	good.event_types[0].booking_flow = 'requires_confirmation';
	good.smtp = { host: 'smtp.example.com', port: 587, user: 'u', pass: 'p' };
	expect(() => validateConfig(good)).not.toThrow();
});

test('duplicate calendar id flagged', () => {
	const bad = clone(validConfig);
	bad.calendars.push({ ...bad.calendars[0] });
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		const issues = (err as ConfigError).issues;
		expect(issues.some((i) => i.message.includes('duplicate calendar id'))).toBe(true);
	}
});

test('duplicate event_type id flagged', () => {
	const bad = clone(validConfig);
	bad.event_types.push({ ...bad.event_types[0], slug: 'other-slug' });
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		const issues = (err as ConfigError).issues;
		expect(issues.some((i) => i.message.includes('duplicate event_type id'))).toBe(true);
	}
});

test('duplicate slug flagged', () => {
	const bad = clone(validConfig);
	bad.event_types.push({ ...bad.event_types[0], id: 'other-id' });
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		const issues = (err as ConfigError).issues;
		expect(issues.some((i) => i.message.includes('duplicate event_type slug'))).toBe(true);
	}
});
