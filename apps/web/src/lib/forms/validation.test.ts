import { describe, expect, test } from 'vitest';
import { validateFieldValue } from './validation.js';
import type { FormField } from '@when/config';

describe('validateFieldValue', () => {
	test('requires guest_name', () => {
		const field: FormField = { name: 'name', label: 'Name', type: 'guest_name', required: true };
		expect(validateFieldValue(field, '')).toBe('Please enter your name.');
		expect(validateFieldValue(field, '   ')).toBe('Please enter your name.');
		expect(validateFieldValue(field, 'Alice')).toBeNull();
	});

	test('validates email format', () => {
		const field: FormField = { name: 'email', label: 'Email', type: 'guest_email', required: true };
		expect(validateFieldValue(field, '')).toBe('Please enter your email.');
		expect(validateFieldValue(field, 'notanemail')).toBe('That email address looks invalid.');
		expect(validateFieldValue(field, 'test@example.com')).toBeNull();
	});

	test('validates optional email format when provided', () => {
		const field: FormField = {
			name: 'email',
			label: 'Email',
			type: 'guest_email',
			required: false
		};
		expect(validateFieldValue(field, '')).toBeNull();
		expect(validateFieldValue(field, 'bademail')).toBe('That email address looks invalid.');
		expect(validateFieldValue(field, 'ok@example.com')).toBeNull();
	});

	test('validates phone format', () => {
		const field: FormField = { name: 'phone', label: 'Phone', type: 'phone', required: true };
		expect(validateFieldValue(field, '')).toBe('This field is required.');
		expect(validateFieldValue(field, '123')).toBe('That phone number looks invalid.');
		expect(validateFieldValue(field, '+1 (555) 123-4567')).toBeNull();
	});

	test('validates number format', () => {
		const field: FormField = { name: 'num', label: 'Guests', type: 'number', required: true };
		expect(validateFieldValue(field, '')).toBe('This field is required.');
		expect(validateFieldValue(field, 'abc')).toBe('Please enter a valid whole number.');
		expect(validateFieldValue(field, '12.5')).toBe('Please enter a valid whole number.');
		expect(validateFieldValue(field, '4')).toBeNull();
	});
});
