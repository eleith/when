import { expect, test } from 'vitest';
import { evaluateVisibility } from './conditional';
import type { FormField } from '@when/config';

const NAME: FormField = { name: 'name', type: 'guest_name', label: 'Name', required: true };
const HOW: FormField = {
	name: 'how',
	type: 'choice',
	label: 'How?',
	required: true,
	choices: ['phone', 'sms', 'email']
};

function valuesOf(values: Record<string, string>) {
	return (name: string) => values[name] ?? '';
}

test('a field with no show_when is always visible', () => {
	const v = evaluateVisibility([NAME], valuesOf({}));
	expect(v.get('name')).toBe(true);
});

test('equals shows the field only on a match', () => {
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
	expect(evaluateVisibility(fields, valuesOf({ how: 'phone' })).get('tel')).toBe(true);
	expect(evaluateVisibility(fields, valuesOf({ how: 'email' })).get('tel')).toBe(false);
});

test('equals accepts a list (same-field OR)', () => {
	const fields: FormField[] = [
		HOW,
		{
			name: 'tel',
			type: 'phone',
			label: 'Phone',
			required: false,
			show_when: [{ field: 'how', equals: ['phone', 'sms'] }]
		}
	];
	expect(evaluateVisibility(fields, valuesOf({ how: 'sms' })).get('tel')).toBe(true);
	expect(evaluateVisibility(fields, valuesOf({ how: 'email' })).get('tel')).toBe(false);
});

test('omitting equals means "filled at all"', () => {
	const fields: FormField[] = [
		{ name: 'ref', type: 'text', label: 'Referral', required: false },
		{
			name: 'detail',
			type: 'text',
			label: 'Details',
			required: false,
			show_when: [{ field: 'ref' }]
		}
	];
	expect(evaluateVisibility(fields, valuesOf({ ref: 'a friend' })).get('detail')).toBe(true);
	expect(evaluateVisibility(fields, valuesOf({ ref: '  ' })).get('detail')).toBe(false);
});

test('multiple conditions are AND', () => {
	const fields: FormField[] = [
		HOW,
		{ name: 'consent', type: 'choice', label: 'OK?', required: false, choices: ['yes', 'no'] },
		{
			name: 'tel',
			type: 'phone',
			label: 'Phone',
			required: false,
			show_when: [
				{ field: 'how', equals: 'phone' },
				{ field: 'consent', equals: 'yes' }
			]
		}
	];
	expect(evaluateVisibility(fields, valuesOf({ how: 'phone', consent: 'yes' })).get('tel')).toBe(
		true
	);
	expect(evaluateVisibility(fields, valuesOf({ how: 'phone', consent: 'no' })).get('tel')).toBe(
		false
	);
});

test('a hidden controller hides its dependents (chain)', () => {
	const fields: FormField[] = [
		HOW,
		{
			name: 'tel',
			type: 'phone',
			label: 'Phone',
			required: false,
			show_when: [{ field: 'how', equals: 'phone' }]
		},
		{
			name: 'ext',
			type: 'text',
			label: 'Extension',
			required: false,
			show_when: [{ field: 'tel' }]
		}
	];
	// how != phone → tel hidden → its value can't satisfy ext's condition
	const v = evaluateVisibility(fields, valuesOf({ how: 'email', tel: '555-1234' }));
	expect(v.get('tel')).toBe(false);
	expect(v.get('ext')).toBe(false);
});
