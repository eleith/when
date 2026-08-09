import type { FormField } from '@when/config';

// A required select has no blank option, so the browser lands on the first choice on first paint.
export function defaultFieldValue(field: FormField): string {
	if (!field.required) return '';
	if (field.type !== 'choice' && field.type !== 'event_location') return '';
	return field.choices?.[0] ?? '';
}
