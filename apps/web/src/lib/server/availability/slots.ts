import type { Interval } from './types';

/**
 * Generate candidate slot starts within a window, stepping by `granularityMin`,
 * such that `start + durationMin <= window.end`.
 */
export function generateSlots(
	window: Interval,
	durationMin: number,
	granularityMin: number
): Temporal.Instant[] {
	if (durationMin <= 0 || granularityMin <= 0) return [];
	const slots: Temporal.Instant[] = [];
	let s = window.start;
	while (true) {
		const end = s.add({ minutes: durationMin });
		if (Temporal.Instant.compare(end, window.end) > 0) break;
		slots.push(s);
		s = s.add({ minutes: granularityMin });
	}
	return slots;
}
