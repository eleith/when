import { expect, test } from 'vitest';
import { ConfigError, validateConfig } from './load.js';
import type { FormField } from './schema.js';
import { validConfig } from './__fixtures__/valid-config.js';

function clone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v));
}

const validForm: FormField[] = [
	{ name: 'name', type: 'guest_name', label: 'Name', required: true },
	{ name: 'email', type: 'guest_email', label: 'Email', required: false },
	{ name: 'notes', type: 'paragraph', label: 'Notes', required: false }
];

function withForm(fields: FormField[]) {
	const cfg = clone(validConfig);
	cfg.meetings[0].form_fields = fields;
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

test('unknown booking_calendar flagged', () => {
	const bad = clone(validConfig);
	bad.meetings[0].booking_calendar = 'does-not-exist';
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		expect(err).toBeInstanceOf(ConfigError);
		const issues = (err as ConfigError).issues;
		expect(issues[0].path).toBe('/meetings/0/booking_calendar');
		expect(issues[0].message).toContain('does-not-exist');
	}
});

test('unknown additional_busy_calendars entry flagged with index', () => {
	const bad = clone(validConfig);
	bad.meetings[0].additional_busy_calendars = ['my-google-cal', 'missing-cal'];
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		const issues = (err as ConfigError).issues;
		expect(issues.some((i) => i.path === '/meetings/0/additional_busy_calendars/1')).toBe(true);
	}
});

test('duplicate calendar name flagged', () => {
	const bad = clone(validConfig);
	bad.calendars.push({ ...bad.calendars[0] });
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		const issues = (err as ConfigError).issues;
		expect(issues.some((i) => i.message.includes('duplicate calendar name'))).toBe(true);
	}
});

test('duplicate meeting name flagged', () => {
	const bad = clone(validConfig);
	bad.meetings.push({ ...bad.meetings[0], slug: 'other-slug' });
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		const issues = (err as ConfigError).issues;
		expect(issues.some((i) => i.message.includes('duplicate meeting name'))).toBe(true);
	}
});

test('duplicate slug flagged', () => {
	const bad = clone(validConfig);
	bad.meetings.push({ ...bad.meetings[0], name: 'other-name' });
	try {
		validateConfig(bad);
		throw new Error('expected ConfigError');
	} catch (err) {
		const issues = (err as ConfigError).issues;
		expect(issues.some((i) => i.message.includes('duplicate meeting slug'))).toBe(true);
	}
});

test('valid form_fields pass', () => {
	const cfg = withForm([
		...validForm,
		{ name: 'how', type: 'choice', label: 'How?', required: true, choices: ['phone', 'video'] }
	]);
	expect(() => validateConfig(cfg)).not.toThrow();
});

test('omitted form_fields pass (falls back to default)', () => {
	expect(() => validateConfig(clone(validConfig))).not.toThrow();
});

test('empty form_fields rejected by the schema', () => {
	expect(() => validateConfig(withForm([]))).toThrow(ConfigError);
});

test('too many form fields flagged', () => {
	const extras: FormField[] = Array.from({ length: 8 }, (_, n) => ({
		name: `extra-${n}`,
		type: 'text',
		label: `Extra ${n}`,
		required: false
	}));
	expect(() => validateConfig(withForm([...validForm, ...extras]))).toThrow(ConfigError);
});

test('duplicate form field name flagged with index', () => {
	const issues = issuesFor(
		withForm([...validForm, { name: 'notes', type: 'text', label: 'Dup', required: false }])
	);
	expect(issues.some((i) => i.path === '/meetings/0/form_fields/3/name')).toBe(true);
});

test('valid show_when passes', () => {
	const cfg = withForm([
		...validForm,
		{ name: 'how', type: 'choice', label: 'How?', required: true, choices: ['phone', 'video'] },
		{
			name: 'tel',
			type: 'phone',
			label: 'Phone',
			required: false,
			show_when: [{ field: 'how', equals: 'phone' }]
		}
	]);
	expect(() => validateConfig(cfg)).not.toThrow();
});

test('show_when with no equals (filled check) passes', () => {
	const cfg = withForm([
		...validForm,
		{
			name: 'why',
			type: 'text',
			label: 'Why?',
			required: false,
			show_when: [{ field: 'notes' }]
		}
	]);
	expect(() => validateConfig(cfg)).not.toThrow();
});

test('show_when referencing a later field is flagged', () => {
	const issues = issuesFor(
		withForm([
			{
				name: 'tel',
				type: 'phone',
				label: 'Phone',
				required: false,
				show_when: [{ field: 'how', equals: 'phone' }]
			},
			...validForm,
			{ name: 'how', type: 'choice', label: 'How?', required: true, choices: ['phone', 'video'] }
		])
	);
	expect(
		issues.some(
			(i) => i.path === '/meetings/0/form_fields/0/show_when/0/field' && i.message.includes('how')
		)
	).toBe(true);
});

test('show_when equals value outside the choice options is flagged', () => {
	const issues = issuesFor(
		withForm([
			...validForm,
			{ name: 'how', type: 'choice', label: 'How?', required: true, choices: ['phone', 'video'] },
			{
				name: 'tel',
				type: 'phone',
				label: 'Phone',
				required: false,
				show_when: [{ field: 'how', equals: 'fax' }]
			}
		])
	);
	expect(
		issues.some(
			(i) => i.path === '/meetings/0/form_fields/4/show_when/0' && i.message.includes('fax')
		)
	).toBe(true);
});

test('missing guest_name flagged', () => {
	const issues = issuesFor(
		withForm([{ name: 'email', type: 'guest_email', label: 'Email', required: false }])
	);
	expect(issues.some((i) => i.message.includes('must include a guest_name'))).toBe(true);
});

test('guest_name not required flagged', () => {
	const issues = issuesFor(
		withForm([{ name: 'name', type: 'guest_name', label: 'Name', required: false }])
	);
	expect(issues.some((i) => i.message.includes('guest_name must be required'))).toBe(true);
});

test('guest_name appearing twice flagged', () => {
	const issues = issuesFor(
		withForm([...validForm, { name: 'name2', type: 'guest_name', label: 'Name', required: true }])
	);
	expect(issues.some((i) => i.message.includes('exactly once'))).toBe(true);
});

test('guest_email appearing twice flagged', () => {
	const issues = issuesFor(
		withForm([
			...validForm,
			{ name: 'email2', type: 'guest_email', label: 'Email', required: false }
		])
	);
	expect(issues.some((i) => i.message.includes('guest_email may appear at most once'))).toBe(true);
});

test('event_location appearing twice flagged', () => {
	const issues = issuesFor(
		withForm([
			...validForm,
			{ name: 'loc1', type: 'event_location', label: 'Where', required: false },
			{ name: 'loc2', type: 'event_location', label: 'Where', required: false }
		])
	);
	expect(issues.some((i) => i.message.includes('event_location may appear at most once'))).toBe(
		true
	);
});

test('choice field without choices rejected by the schema', () => {
	const cfg = clone(validConfig) as unknown as Record<string, unknown>;
	(cfg.meetings as Record<string, unknown>[])[0].form_fields = [
		...validForm,
		{ name: 'how', type: 'choice', label: 'How?', required: true }
	];
	expect(() => validateConfig(cfg)).toThrow(ConfigError);
});

test('choices on a plain field rejected by the schema', () => {
	const cfg = clone(validConfig) as unknown as Record<string, unknown>;
	(cfg.meetings as Record<string, unknown>[])[0].form_fields = [
		...validForm,
		{ name: 'topic', type: 'text', label: 'Topic?', required: false, choices: ['a', 'b'] }
	];
	expect(() => validateConfig(cfg)).toThrow(ConfigError);
});

test('event_location keeps its optional choices', () => {
	const withPicklist = withForm([
		...validForm,
		{ name: 'where', type: 'event_location', label: 'Where?', required: false, choices: ['a'] }
	]);
	expect(() => validateConfig(withPicklist)).not.toThrow();

	const freeText = withForm([
		...validForm,
		{ name: 'where', type: 'event_location', label: 'Where?', required: false }
	]);
	expect(() => validateConfig(freeText)).not.toThrow();
});

test('unknown provider in calendar flagged', () => {
	const bad = clone(validConfig);
	bad.calendars[0].provider = 'non-existent';
	const issues = issuesFor(bad);
	expect(
		issues.some((i) => i.path === '/calendars/0/provider' && i.message.includes('unknown provider'))
	).toBe(true);
});

test('duplicate provider name flagged', () => {
	const bad = clone(validConfig);
	bad.providers!.push({ ...bad.providers![0] });
	const issues = issuesFor(bad);
	expect(
		issues.some((i) => i.path === '/providers/1/name' && i.message.includes('duplicate provider'))
	).toBe(true);
});

test('unknown video_chat_provider reference in meeting flagged', () => {
	const bad = clone(validConfig);
	bad.meetings[0].video_chat_provider = 'non-existent';
	const issues = issuesFor(bad);
	expect(
		issues.some(
			(i) => i.path === '/meetings/0/video_chat_provider' && i.message.includes('unknown provider')
		)
	).toBe(true);
});

test('Google Meet video_chat_provider with CalDAV booking calendar flagged', () => {
	const bad = clone(validConfig);
	bad.providers!.push({
		name: 'nextcloud-service',
		type: 'nextcloud',
		url: 'https://cloud.example.com',
		username: 'jane',
		password: 'pwd'
	});
	bad.calendars.push({
		name: 'caldav-cal',
		type: 'caldav',
		provider: 'nextcloud-service',
		url: 'https://cloud.example.com/cal/',
		sync: { refresh_every_minutes: 10 }
	});
	bad.meetings[0].booking_calendar = 'caldav-cal';
	bad.meetings[0].video_chat_provider = 'google-service'; // google-service is of type google

	const issues = issuesFor(bad);
	expect(
		issues.some(
			(i) =>
				i.path === '/meetings/0/video_chat_provider' &&
				i.message.includes('Google Meet dynamic video chat is only supported')
		)
	).toBe(true);
});

test('duplicate schedule name flagged', () => {
	const bad = clone(validConfig);
	bad.schedules.push({ ...bad.schedules[0] });
	const issues = issuesFor(bad);
	expect(
		issues.some(
			(i) => i.path === '/schedules/1/name' && i.message.includes('duplicate schedule name')
		)
	).toBe(true);
});

test('empty window (from >= to) flagged', () => {
	const bad = clone(validConfig);
	bad.schedules[0].weekly[0].to = bad.schedules[0].weekly[0].from;
	const issues = issuesFor(bad);
	expect(
		issues.some((i) => i.path === '/schedules/0/weekly/0' && i.message.includes('empty window'))
	).toBe(true);
});

test('unknown schedule reference in meeting flagged', () => {
	const bad = clone(validConfig);
	bad.meetings[0].schedule = 'non-existent';
	const issues = issuesFor(bad);
	expect(
		issues.some(
			(i) => i.path === '/meetings/0/schedule' && i.message.includes('unknown schedule name')
		)
	).toBe(true);
});

test('select booking style with start_times_every_minutes less than duration_minutes is flagged', () => {
	const bad = clone(validConfig);
	bad.meetings[0].booking_style = 'select';
	bad.meetings[0].start_times_every_minutes = 15;
	bad.meetings[0].duration_minutes = 30;
	const issues = issuesFor(bad);
	expect(
		issues.some(
			(i) =>
				i.path === '/meetings/0/start_times_every_minutes' &&
				i.message.includes('must be greater than or equal')
		)
	).toBe(true);
});

test('select booking style with start_times_every_minutes equal or greater than duration_minutes passes', () => {
	const good = clone(validConfig);
	good.meetings[0].booking_style = 'select';
	good.meetings[0].start_times_every_minutes = 30;
	good.meetings[0].duration_minutes = 30;
	expect(() => validateConfig(good)).not.toThrow();
});

test('select booking style with a duration array guards against the longest length', () => {
	const bad = clone(validConfig);
	bad.meetings[0].booking_style = 'select';
	bad.meetings[0].duration_minutes = [15, 30, 60];
	bad.meetings[0].start_times_every_minutes = 30; // < longest (60)
	const issues = issuesFor(bad);
	expect(
		issues.some(
			(i) => i.path === '/meetings/0/start_times_every_minutes' && i.message.includes('60')
		)
	).toBe(true);
});

test('select booking style with a duration array passes when the step covers the longest', () => {
	const good = clone(validConfig);
	good.meetings[0].booking_style = 'select';
	good.meetings[0].duration_minutes = [15, 30, 60];
	good.meetings[0].start_times_every_minutes = 60;
	expect(() => validateConfig(good)).not.toThrow();
});
