import { resolveFormFields, type GuestAnswer, type Meeting } from '@when/config';

const LIMIT_SHORT = 200;
const LIMIT_LONG = 1000;
const LIMIT_EMAIL = 254;
const LIMIT_REASON = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedAppointment {
	name: string;
	email: string | null;
	location: string | null;
	answers: GuestAnswer[];
}

export type ParseAppointmentResult =
	| { ok: true; data: ParsedAppointment }
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

export function parseAndValidateAppointmentForm(
	eventType: Meeting,
	formData: FormData
): ParseAppointmentResult {
	const fields = resolveFormFields(eventType);
	const errors: Record<string, string> = {};
	const answers: GuestAnswer[] = [];

	let name = '';
	let email: string | null = null;
	let location: string | null = eventType.location ?? null;

	for (const field of fields) {
		const raw = formData.get(field.name);
		const value = typeof raw === 'string' ? raw.trim() : '';

		switch (field.type) {
			case 'guest_name': {
				if (!value) errors[field.name] = 'Please enter your name.';
				else if (value.length > LIMIT_SHORT)
					errors[field.name] = `Please keep this under ${LIMIT_SHORT} characters.`;
				else name = value;
				break;
			}
			case 'guest_email': {
				if (!value) {
					if (field.required) errors[field.name] = 'Please enter your email.';
				} else if (value.length > LIMIT_EMAIL) {
					errors[field.name] = `Please keep this under ${LIMIT_EMAIL} characters.`;
				} else if (!EMAIL_RE.test(value)) {
					errors[field.name] = 'That email address looks invalid.';
				} else {
					email = value;
				}
				break;
			}
			case 'event_location': {
				if (!value) {
					if (field.required) errors[field.name] = 'Please choose a location.';
				} else if (value.length > LIMIT_SHORT) {
					errors[field.name] = `Please keep this under ${LIMIT_SHORT} characters.`;
				} else if (field.choices && !field.choices.includes(value)) {
					errors[field.name] = 'Pick a valid location option.';
				} else {
					location = value;
				}
				break;
			}
			default: {
				if (!value) {
					if (field.required) errors[field.name] = 'This field is required.';
					break;
				}
				const limit = field.type === 'paragraph' ? LIMIT_LONG : LIMIT_SHORT;
				if (value.length > limit) {
					errors[field.name] = `Please keep this under ${limit} characters.`;
				} else if (field.type === 'number' && Number.isNaN(Number(value))) {
					errors[field.name] = 'Please enter a number.';
				} else if (field.type === 'choice' && !field.choices?.includes(value)) {
					errors[field.name] = 'Pick a valid option.';
				} else {
					answers.push({ name: field.name, label: field.label, type: field.type, value });
				}
			}
		}
	}

	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, data: { name, email, location, answers } };
}

export type ReasonPurpose = 'cancelling' | 'rescheduling';

export type ValidateReasonResult = { ok: true; reason: string } | { ok: false; error: string };

// Cancel and reschedule submit the reason under different field names.
export function validateReason(form: FormData, purpose: ReasonPurpose): ValidateReasonResult {
	const field = purpose === 'rescheduling' ? 'reschedule_reason' : 'reason';
	const reason = String(form.get(field) ?? '').trim();

	if (!reason) {
		return {
			ok: false,
			error:
				purpose === 'rescheduling'
					? 'Please provide a reason for rescheduling.'
					: 'Please provide a reason for cancelling.'
		};
	}
	if (reason.length > LIMIT_REASON) {
		return {
			ok: false,
			error:
				purpose === 'rescheduling'
					? `Reason for rescheduling must be ${LIMIT_REASON} characters or fewer.`
					: `Reason must be ${LIMIT_REASON} characters or fewer.`
		};
	}
	return { ok: true, reason };
}
