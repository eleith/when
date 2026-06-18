import { expect, test } from 'vitest';
import { DEFAULT_FORM_FIELDS, parseAttendeeAnswers, resolveFormFields } from './form-fields.js';
import type { EventType } from './schema.js';

const baseEventType: EventType = {
	id: 'et',
	name: 'Chat',
	duration: 30,
	slug: 'chat',
	booking_flow: 'auto',
	destination_calendar: 'cal'
};

test('resolveFormFields falls back to the default form when unset', () => {
	expect(resolveFormFields(baseEventType)).toBe(DEFAULT_FORM_FIELDS);
});

test('resolveFormFields returns the configured fields when present', () => {
	const form = [{ id: 'name', type: 'attendee_name' as const, label: 'Name', required: true }];
	expect(resolveFormFields({ ...baseEventType, form_fields: form })).toBe(form);
});

test('the default form is valid against its own rules', () => {
	const names = DEFAULT_FORM_FIELDS.filter((f) => f.type === 'attendee_name');
	expect(names).toHaveLength(1);
	expect(names[0].required).toBe(true);
});

test('parseAttendeeAnswers parses a stored array', () => {
	const json = JSON.stringify([{ id: 'phone', label: 'Phone', type: 'text', value: '+1' }]);
	expect(parseAttendeeAnswers(json)).toEqual([
		{ id: 'phone', label: 'Phone', type: 'text', value: '+1' }
	]);
});

test('parseAttendeeAnswers returns [] for null, empty, or malformed input', () => {
	expect(parseAttendeeAnswers(null)).toEqual([]);
	expect(parseAttendeeAnswers(undefined)).toEqual([]);
	expect(parseAttendeeAnswers('')).toEqual([]);
	expect(parseAttendeeAnswers('not json')).toEqual([]);
	expect(parseAttendeeAnswers('{"not":"array"}')).toEqual([]);
});
