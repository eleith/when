import type { EventType, FormField } from './schema.js';

export const DEFAULT_FORM_FIELDS: readonly FormField[] = [
	{ id: 'name', type: 'guest_name', label: 'What is your name?', required: true },
	{ id: 'email', type: 'guest_email', label: 'What is your email?', required: true },
	{ id: 'notes', type: 'paragraph', label: 'Anything else?', required: false }
];

export function resolveFormFields(eventType: EventType): readonly FormField[] {
	return eventType.form_fields ?? DEFAULT_FORM_FIELDS;
}

export interface GuestAnswer {
	id: string;
	label: string;
	type: FormField['type'];
	value: string;
}

export function parseGuestAnswers(json: string | null | undefined): GuestAnswer[] {
	if (!json) return [];
	try {
		const parsed = JSON.parse(json);
		return Array.isArray(parsed) ? (parsed as GuestAnswer[]) : [];
	} catch {
		return [];
	}
}
