import { expect, test } from 'vitest';
import { ConfigError, validateConfig } from './load.js';
import type { FormField } from './schema.js';
import { validConfig } from './__fixtures__/valid-config.js';

function clone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v));
}

const validForm: FormField[] = [
	{ id: 'name', type: 'attendee_name', label: 'Name', required: true },
	{ id: 'email', type: 'attendee_email', label: 'Email', required: false },
	{ id: 'notes', type: 'paragraph', label: 'Notes', required: false }
];

function withForm(fields: FormField[]) {
	const cfg = clone(validConfig);
	cfg.event_types[0].form_fields = fields;
	return cfg;
}

function issuesFor(cfg: ReturnType<typeof clone>): ConfigError['issues'] {
	try {
		validateConfig(cfg);
		throw new Error('expected ConfigError');
	} catch (err) {
		expect(err).toBeInstanceOf(ConfigError);
		return (err as ConfigError).issues;
	}
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

test('valid form_fields pass', () => {
	const cfg = withForm([
		...validForm,
		{ id: 'how', type: 'choice', label: 'How?', required: true, choices: ['phone', 'video'] }
	]);
	expect(() => validateConfig(cfg)).not.toThrow();
});

test('omitted form_fields pass (falls back to default)', () => {
	expect(() => validateConfig(clone(validConfig))).not.toThrow();
});

test('empty form_fields flagged', () => {
	const issues = issuesFor(withForm([]));
	expect(issues.some((i) => i.message.includes('at least one field'))).toBe(true);
});

test('too many form fields flagged', () => {
	const extras: FormField[] = Array.from({ length: 8 }, (_, n) => ({
		id: `extra-${n}`,
		type: 'text',
		label: `Extra ${n}`,
		required: false
	}));
	const issues = issuesFor(withForm([...validForm, ...extras]));
	expect(issues.some((i) => i.message.includes('exceeds the max'))).toBe(true);
});

test('duplicate form field id flagged with index', () => {
	const issues = issuesFor(
		withForm([...validForm, { id: 'notes', type: 'text', label: 'Dup', required: false }])
	);
	expect(issues.some((i) => i.path === '/event_types/0/form_fields/3/id')).toBe(true);
});

test('missing attendee_name flagged', () => {
	const issues = issuesFor(
		withForm([{ id: 'email', type: 'attendee_email', label: 'Email', required: false }])
	);
	expect(issues.some((i) => i.message.includes('must include an attendee_name'))).toBe(true);
});

test('attendee_name not required flagged', () => {
	const issues = issuesFor(
		withForm([{ id: 'name', type: 'attendee_name', label: 'Name', required: false }])
	);
	expect(issues.some((i) => i.message.includes('attendee_name must be required'))).toBe(true);
});

test('attendee_name appearing twice flagged', () => {
	const issues = issuesFor(
		withForm([...validForm, { id: 'name2', type: 'attendee_name', label: 'Name', required: true }])
	);
	expect(issues.some((i) => i.message.includes('exactly once'))).toBe(true);
});

test('attendee_email appearing twice flagged', () => {
	const issues = issuesFor(
		withForm([
			...validForm,
			{ id: 'email2', type: 'attendee_email', label: 'Email', required: false }
		])
	);
	expect(issues.some((i) => i.message.includes('attendee_email may appear at most once'))).toBe(
		true
	);
});

test('event_location appearing twice flagged', () => {
	const issues = issuesFor(
		withForm([
			...validForm,
			{ id: 'loc1', type: 'event_location', label: 'Where', required: false },
			{ id: 'loc2', type: 'event_location', label: 'Where', required: false }
		])
	);
	expect(issues.some((i) => i.message.includes('event_location may appear at most once'))).toBe(
		true
	);
});

test('choice field without choices flagged', () => {
	const issues = issuesFor(
		withForm([...validForm, { id: 'how', type: 'choice', label: 'How?', required: true }])
	);
	expect(issues.some((i) => i.path === '/event_types/0/form_fields/3/choices')).toBe(true);
});
