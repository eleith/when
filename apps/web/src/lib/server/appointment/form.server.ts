import { resolveFormFields, type AttendeeAnswer, type EventType } from '@when/config';

const LIMIT_SHORT = 200;
const LIMIT_LONG = 1000;
const LIMIT_EMAIL = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedBooking {
	name: string;
	email: string | null;
	location: string | null;
	answers: AttendeeAnswer[];
}

export type ParseBookingResult =
	| { ok: true; data: ParsedBooking }
	| { ok: false; errors: Record<string, string> };

export function resolveTimezone(raw: FormDataEntryValue | null, fallback: string): string {
	const tz = typeof raw === 'string' ? raw.trim() : '';
	if (!tz) return fallback;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return tz;
	} catch {
		return fallback;
	}
}

export function parseAndValidateBookingForm(
	eventType: EventType,
	formData: FormData
): ParseBookingResult {
	const fields = resolveFormFields(eventType);
	const errors: Record<string, string> = {};
	const answers: AttendeeAnswer[] = [];

	let name = '';
	let email: string | null = null;
	let location: string | null = eventType.location?.fixed ?? null;

	for (const field of fields) {
		const raw = formData.get(field.id);
		const value = typeof raw === 'string' ? raw.trim() : '';

		switch (field.type) {
			case 'attendee_name': {
				if (!value) errors[field.id] = 'Please enter your name.';
				else if (value.length > LIMIT_SHORT)
					errors[field.id] = `Please keep this under ${LIMIT_SHORT} characters.`;
				else name = value;
				break;
			}
			case 'attendee_email': {
				if (!value) {
					if (field.required) errors[field.id] = 'Please enter your email.';
				} else if (value.length > LIMIT_EMAIL) {
					errors[field.id] = `Please keep this under ${LIMIT_EMAIL} characters.`;
				} else if (!EMAIL_RE.test(value)) {
					errors[field.id] = 'That email address looks invalid.';
				} else {
					email = value;
				}
				break;
			}
			case 'event_location': {
				if (!value) {
					if (field.required) errors[field.id] = 'Please choose a location.';
				} else if (value.length > LIMIT_SHORT) {
					errors[field.id] = `Please keep this under ${LIMIT_SHORT} characters.`;
				} else if (field.choices && !field.choices.includes(value)) {
					errors[field.id] = 'Pick a valid location option.';
				} else {
					location = value;
				}
				break;
			}
			default: {
				if (!value) {
					if (field.required) errors[field.id] = 'This field is required.';
					break;
				}
				const limit = field.type === 'paragraph' ? LIMIT_LONG : LIMIT_SHORT;
				if (value.length > limit) {
					errors[field.id] = `Please keep this under ${limit} characters.`;
				} else if (field.type === 'number' && Number.isNaN(Number(value))) {
					errors[field.id] = 'Please enter a number.';
				} else if (field.type === 'choice' && !field.choices?.includes(value)) {
					errors[field.id] = 'Pick a valid option.';
				} else {
					answers.push({ id: field.id, label: field.label, type: field.type, value });
				}
			}
		}
	}

	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, data: { name, email, location, answers } };
}
