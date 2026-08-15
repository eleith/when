import { PHONE_RE } from './phone.js';
import type { FormField } from '@when/config';

export const LIMIT_SHORT = 200;
export const LIMIT_LONG = 1000;
export const LIMIT_EMAIL = 254;
export const LIMIT_REASON = 500;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export { PHONE_RE, PHONE_PATTERN } from './phone.js';

export function validateFieldValue(field: FormField, rawValue: string): string | null {
	const value = rawValue.trim();
	if (!value) {
		if (field.required || field.type === 'guest_name') {
			if (field.type === 'guest_name') return 'Please enter your name.';
			if (field.type === 'guest_email') return 'Please enter your email.';
			if (field.name === 'reschedule_reason') return 'Please provide a reason for rescheduling.';
			return 'This field is required.';
		}
		return null;
	}
	switch (field.type) {
		case 'guest_name':
			if (value.length > LIMIT_SHORT) return `Please keep this under ${LIMIT_SHORT} characters.`;
			return null;
		case 'guest_email':
			if (value.length > LIMIT_EMAIL) return `Please keep this under ${LIMIT_EMAIL} characters.`;
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
		case 'paragraph': {
			const max = field.name === 'reschedule_reason' ? LIMIT_REASON : LIMIT_LONG;
			if (value.length > max) return `Please keep this under ${max} characters.`;
			return null;
		}
		default:
			if (value.length > LIMIT_SHORT) return `Please keep this under ${LIMIT_SHORT} characters.`;
			return null;
	}
}
