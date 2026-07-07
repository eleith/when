import { describe, expect, test } from 'vitest';
import type { EventType, FormField } from '@when/config';
import { parseAndValidateAppointmentForm, resolveTimezone, validateReason } from './form.server';

const baseEvent: EventType = {
	id: 'et',
	name: 'Chat',
	duration: 30,
	slug: 'chat',
	appointment_flow: 'auto',
	destination_calendar: 'cal',
	availability: 'standard'
};

function eventWith(form_fields: FormField[], location?: EventType['location']): EventType {
	return { ...baseEvent, form_fields, location };
}

function fd(entries: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(entries)) f.set(k, v);
	return f;
}

describe('parseAndValidateAppointmentForm', () => {
	test('default form: collects name and email, no answers', () => {
		const r = parseAndValidateAppointmentForm(
			baseEvent,
			fd({ name: 'Jane', email: 'jane@example.com' })
		);
		expect(r).toEqual({
			ok: true,
			data: { name: 'Jane', email: 'jane@example.com', location: null, answers: [] }
		});
	});

	test('default form: a paragraph note becomes an answer snapshot', () => {
		const r = parseAndValidateAppointmentForm(
			baseEvent,
			fd({ name: 'Jane', email: 'jane@example.com', notes: 'Hi there' })
		);
		expect(r.ok && r.data.answers).toEqual([
			{ id: 'notes', label: 'Anything else?', type: 'paragraph', value: 'Hi there' }
		]);
	});

	test('missing name is an error keyed by field id', () => {
		const r = parseAndValidateAppointmentForm(baseEvent, fd({ email: 'jane@example.com' }));
		expect(r.ok).toBe(false);
		expect(!r.ok && r.errors.name).toBeTruthy();
	});

	test('invalid email is rejected', () => {
		const r = parseAndValidateAppointmentForm(baseEvent, fd({ name: 'Jane', email: 'nope' }));
		expect(!r.ok && r.errors.email).toBeTruthy();
	});

	test('email may be omitted when the field is optional', () => {
		const event = eventWith([
			{ id: 'name', type: 'guest_name', label: 'Name', required: true },
			{ id: 'email', type: 'guest_email', label: 'Email', required: false }
		]);
		const r = parseAndValidateAppointmentForm(event, fd({ name: 'Jane' }));
		expect(r.ok && r.data.email).toBeNull();
	});

	test('number must parse as a number', () => {
		const event = eventWith([
			{ id: 'name', type: 'guest_name', label: 'Name', required: true },
			{ id: 'age', type: 'number', label: 'Age', required: true }
		]);
		expect(parseAndValidateAppointmentForm(event, fd({ name: 'Jane', age: 'abc' })).ok).toBe(false);
		expect(parseAndValidateAppointmentForm(event, fd({ name: 'Jane', age: '42' })).ok).toBe(true);
	});

	test('choice must be one of the configured options', () => {
		const event = eventWith([
			{ id: 'name', type: 'guest_name', label: 'Name', required: true },
			{ id: 'how', type: 'choice', label: 'How?', required: true, choices: ['phone', 'video'] }
		]);
		expect(parseAndValidateAppointmentForm(event, fd({ name: 'Jane', how: 'fax' })).ok).toBe(false);
		const ok = parseAndValidateAppointmentForm(event, fd({ name: 'Jane', how: 'video' }));
		expect(ok.ok && ok.data.answers[0].value).toBe('video');
	});

	test('paragraph over the long limit is rejected', () => {
		const r = parseAndValidateAppointmentForm(
			baseEvent,
			fd({ name: 'Jane', email: 'jane@example.com', notes: 'x'.repeat(1001) })
		);
		expect(!r.ok && r.errors.notes).toBeTruthy();
	});

	test('event_location overrides a fixed config when filled', () => {
		const event = eventWith(
			[
				{ id: 'name', type: 'guest_name', label: 'Name', required: true },
				{ id: 'loc', type: 'event_location', label: 'Where', required: false }
			],
			'Room A'
		);
		const filled = parseAndValidateAppointmentForm(event, fd({ name: 'Jane', loc: 'Room B' }));
		expect(filled.ok && filled.data.location).toBe('Room B');
		const empty = parseAndValidateAppointmentForm(event, fd({ name: 'Jane' }));
		expect(empty.ok && empty.data.location).toBe('Room A');
	});

	test('event_location with choices validates membership', () => {
		const event = eventWith([
			{ id: 'name', type: 'guest_name', label: 'Name', required: true },
			{
				id: 'loc',
				type: 'event_location',
				label: 'Where',
				required: true,
				choices: ['Zoom', 'Phone']
			}
		]);
		expect(
			parseAndValidateAppointmentForm(event, fd({ name: 'Jane', loc: 'Carrier pigeon' })).ok
		).toBe(false);
		const ok = parseAndValidateAppointmentForm(event, fd({ name: 'Jane', loc: 'Zoom' }));
		expect(ok.ok && ok.data.location).toBe('Zoom');
	});
});

describe('validateReason', () => {
	test('reads the reschedule field and trims', () => {
		const r = validateReason(fd({ reschedule_reason: '  conflict  ' }), 'rescheduling');
		expect(r).toEqual({ ok: true, reason: 'conflict' });
	});

	test('reads the cancel field', () => {
		const r = validateReason(fd({ reason: 'no longer needed' }), 'cancelling');
		expect(r).toEqual({ ok: true, reason: 'no longer needed' });
	});

	test('blank reason is rejected with a purpose-specific message', () => {
		expect(validateReason(fd({}), 'cancelling')).toEqual({
			ok: false,
			error: 'Please provide a reason for cancelling.'
		});
		expect(validateReason(fd({ reschedule_reason: '   ' }), 'rescheduling')).toEqual({
			ok: false,
			error: 'Please provide a reason for rescheduling.'
		});
	});

	test('over 500 characters is rejected', () => {
		const long = 'x'.repeat(501);
		expect(validateReason(fd({ reason: long }), 'cancelling').ok).toBe(false);
		expect(validateReason(fd({ reschedule_reason: long }), 'rescheduling').ok).toBe(false);
		expect(validateReason(fd({ reason: 'x'.repeat(500) }), 'cancelling').ok).toBe(true);
	});
});

describe('resolveTimezone', () => {
	test('keeps a valid IANA zone', () => {
		expect(resolveTimezone('Europe/London', 'UTC')).toBe('Europe/London');
	});

	test('falls back when blank, missing, or invalid', () => {
		expect(resolveTimezone('', 'UTC')).toBe('UTC');
		expect(resolveTimezone(null, 'UTC')).toBe('UTC');
		expect(resolveTimezone('Mars/Olympus', 'UTC')).toBe('UTC');
	});
});
