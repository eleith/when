import type { Temporal } from '@js-temporal/polyfill';
import { mergeBlocks } from './blocks';
import { filterSlots } from './filter';
import { generateSlots } from './slots';
import type { EventTypeKnobs, Interval } from './types';
import { buildBaseWindows, candidateDates } from './windows';

export interface ComputeOptions {
	knobs: EventTypeKnobs;
	rangeStart: Temporal.Instant;
	rangeEnd: Temporal.Instant;
	userTz: string;
	now: Temporal.Instant;
	/** Active appointments overlapping the range, as UTC intervals. */
	existingAppointments: Interval[];
	/** Remote calendar busy intervals (RRULE-expanded already). */
	remoteBusy: Interval[];
	/** Active-booking counts keyed by user_tz YYYY-MM-DD. */
	perDayCount: Map<string, number>;
}

export function computeSlots(opts: ComputeOptions): Temporal.Instant[] {
	const {
		knobs,
		rangeStart,
		rangeEnd,
		userTz,
		now,
		existingAppointments,
		remoteBusy,
		perDayCount
	} = opts;

	const dates = candidateDates(rangeStart, rangeEnd, userTz);
	const windows: Interval[] = [];
	for (const date of dates) {
		windows.push(...buildBaseWindows(date, knobs.weekly, userTz));
	}

	const blocks = mergeBlocks([...existingAppointments, ...remoteBusy]);

	const allSlots = windows.flatMap((w) => generateSlots(w, knobs.duration, knobs.slot_granularity));

	return filterSlots(allSlots, { blocks, knobs, now, userTz, perDayCount });
}
