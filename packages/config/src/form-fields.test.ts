import { expect, test } from 'vitest';
import { DEFAULT_FORM_FIELDS, parseGuestAnswers, resolveFormFields } from './form-fields.js';
import type { EventType } from './schema.js';

const baseEventType: EventType = {
	id: 'et',
	name: 'Chat',
	duration: 30,
	slug: 'chat',
	appointment_flow: 'auto',
	destination_calendar: 'cal'
};

test('resolveFormFields falls back to the default form when unset', () => {
	expect(resolveFormFields(baseEventType)).toBe(DEFAULT_FORM_FIELDS);
});

test('resolveFormFields returns the configured fields when present', () => {
	const form = [{ id: 'name', type: 'guest_name' as const, label: 'Name', required: true }];
	expect(resolveFormFields({ ...baseEventType, form_fields: form })).toBe(form);
});

test('the default form is valid against its own rules', () => {
	const names = DEFAULT_FORM_FIELDS.filter((f) => f.type === 'guest_name');
	expect(names).toHaveLength(1);
	expect(names[0].required).toBe(true);
});

test('parseGuestAnswers parses a stored array', () => {
	const json = JSON.stringify([{ id: 'phone', label: 'Phone', type: 'text', value: '+1' }]);
	expect(parseGuestAnswers(json)).toEqual([
		{ id: 'phone', label: 'Phone', type: 'text', value: '+1' }
	]);
});

test('parseGuestAnswers returns [] for null, empty, or malformed input', () => {
	expect(parseGuestAnswers(null)).toEqual([]);
	expect(parseGuestAnswers(undefined)).toEqual([]);
	expect(parseGuestAnswers('')).toEqual([]);
	expect(parseGuestAnswers('not json')).toEqual([]);
	expect(parseGuestAnswers('{"not":"array"}')).toEqual([]);
});
