import { expect, test } from 'vitest';
import { defaultFieldValue } from './defaults';
import { evaluateVisibility } from './conditional';
import type { FormField } from '@when/config';

const HOW: FormField = {
	name: 'how',
	type: 'choice',
	label: 'How?',
	required: true,
	choices: ['phone', 'sms', 'email']
};

test('a required choice defaults to its first option', () => {
	expect(defaultFieldValue(HOW)).toBe('phone');
});

test('an optional choice defaults to empty (it renders a blank option)', () => {
	expect(defaultFieldValue({ ...HOW, required: false })).toBe('');
});

test('a required event_location without choices defaults to empty', () => {
	expect(
		defaultFieldValue({ name: 'where', type: 'event_location', label: 'Where?', required: true })
	).toBe('');
});

test('a required text field defaults to empty', () => {
	expect(defaultFieldValue({ name: 'ref', type: 'text', label: 'Referral', required: true })).toBe(
		''
	);
});

test('a dependent field is visible on first paint when the default already matches', () => {
	const fields: FormField[] = [
		HOW,
		{
			name: 'tel',
			type: 'phone',
			label: 'Phone',
			required: false,
			show_when: [{ field: 'how', equals: 'phone' }]
		}
	];
	const defaults = new Map(fields.map((f) => [f.name, defaultFieldValue(f)]));
	const visible = evaluateVisibility(fields, (name) => defaults.get(name) ?? '');
	expect(visible.get('tel')).toBe(true);
});
