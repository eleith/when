import { expect, test } from 'vitest';
import { DEFAULT_FORM_FIELDS, parseGuestAnswers, resolveFormFields } from './form-fields.js';
import type { Meeting } from './schema.js';
import { validConfig } from './__fixtures__/valid-config.js';

const baseMeeting: Meeting = {
	...validConfig.meetings['30-min-chat'],
	title: 'et',
	booking_calendar: 'cal'
};

test('resolveFormFields falls back to the default form when unset', () => {
	expect(resolveFormFields(baseMeeting)).toBe(DEFAULT_FORM_FIELDS);
});

test('resolveFormFields returns the configured fields when present', () => {
	const form = [{ name: 'name', type: 'guest_name' as const, label: 'Name', required: true }];
	expect(resolveFormFields({ ...baseMeeting, form_fields: form })).toBe(form);
});

test('the default form is valid against its own rules', () => {
	const names = DEFAULT_FORM_FIELDS.filter((f) => f.type === 'guest_name');
	expect(names).toHaveLength(1);
	expect(names[0].required).toBe(true);
});

test('parseGuestAnswers parses a stored array', () => {
	const json = JSON.stringify([{ name: 'phone', label: 'Phone', type: 'text', value: '+1' }]);
	expect(parseGuestAnswers(json)).toEqual([
		{ name: 'phone', label: 'Phone', type: 'text', value: '+1' }
	]);
});

test('parseGuestAnswers returns [] for null, empty, or malformed input', () => {
	expect(parseGuestAnswers(null)).toEqual([]);
	expect(parseGuestAnswers(undefined)).toEqual([]);
	expect(parseGuestAnswers('')).toEqual([]);
	expect(parseGuestAnswers('not json')).toEqual([]);
	expect(parseGuestAnswers('{"not":"array"}')).toEqual([]);
});
