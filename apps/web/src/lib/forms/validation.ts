import { PHONE_RE } from './phone.js';
import type { FormField } from '@when/config';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export { PHONE_RE, PHONE_PATTERN } from './phone.js';

export function validateFieldValue(field: FormField, rawValue: string): string | null {
	const value = rawValue.trim();
	if (!value) {
		if (field.required || field.type === 'guest_name') {
			return field.type === 'guest_name' ? 'Please enter your name.' : 'This field is required.';
		}
		return null;
	}
	switch (field.type) {
		case 'guest_name':
			if (value.length > 200) return 'Please keep this under 200 characters.';
			return null;
		case 'guest_email':
			if (value.length > 254) return 'Please keep this under 254 characters.';
			if (!EMAIL_RE.test(value)) return 'That email address looks invalid.';
			return null;
		case 'phone':
			if (!PHONE_RE.test(value)) return 'That phone number looks invalid.';
			return null;
		case 'number':
			if (isNaN(Number(value)) || !Number.isInteger(Number(value))) {
				return 'Please enter a valid whole number.';
			}
			return null;
		case 'paragraph':
			if (value.length > 1000) return 'Please keep this under 1000 characters.';
			return null;
		default:
			if (value.length > 200) return 'Please keep this under 200 characters.';
			return null;
	}
}
