import type { Meeting } from './schema.js';

/** A meeting's offered lengths: the default first, then the additional ones, de-duplicated. */
export function durationsOf(
	meeting: Pick<Meeting, 'duration_minutes' | 'additional_duration_minutes'>
): number[] {
	return [...new Set([meeting.duration_minutes, ...meeting.additional_duration_minutes])];
}
