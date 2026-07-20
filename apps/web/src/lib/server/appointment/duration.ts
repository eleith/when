import { durationsOf, type Meeting } from '@when/config';

// Missing → the default (first) length; a submitted value the meeting doesn't offer → null.
export function resolveDuration(eventType: Meeting, form: FormData): number | null {
	const durations = durationsOf(eventType);
	const raw = form.get('duration');
	if (raw === null || raw === '') return durations[0];
	const value = Number(raw);
	return durations.includes(value) ? value : null;
}
