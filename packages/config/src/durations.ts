import type { Meeting } from './schema.js';

/**
 * A meeting's offered lengths as an ordered, de-duplicated list. A single value
 * becomes a one-element list; config order is preserved, so the first entry is
 * the default selection and the toggle order.
 */
export function durationsOf(meeting: Pick<Meeting, 'duration_minutes'>): number[] {
	const value = meeting.duration_minutes;
	return [...new Set(Array.isArray(value) ? value : [value])];
}
