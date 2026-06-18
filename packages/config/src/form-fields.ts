import type { EventType, FormField } from './schema.js';

export const DEFAULT_FORM_FIELDS: readonly FormField[] = [
	{ id: 'name', type: 'attendee_name', label: 'What is your name?', required: true },
	{ id: 'email', type: 'attendee_email', label: 'What is your email?', required: true },
	{ id: 'notes', type: 'paragraph', label: 'Anything else?', required: false }
];

export function resolveFormFields(eventType: EventType): readonly FormField[] {
	return eventType.form_fields ?? DEFAULT_FORM_FIELDS;
}

export interface AttendeeAnswer {
	id: string;
	label: string;
	type: FormField['type'];
	value: string;
}
