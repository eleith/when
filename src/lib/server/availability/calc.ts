import type { Temporal } from '@js-temporal/polyfill';
import { mergeBlocks } from './blocks';
import { filterSlots } from './filter';
import { generateSlots } from './slots';
import type { DateOverride, EventTypeKnobs, Interval } from './types';
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
	/** Per-date overrides (Phase 6); keyed by user_tz YYYY-MM-DD. */
	dateOverrides?: Map<string, DateOverride>;
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
		perDayCount,
		dateOverrides
	} = opts;

	const dates = candidateDates(rangeStart, rangeEnd, userTz);
	const windows: Interval[] = [];
	for (const date of dates) {
		const override = dateOverrides?.get(date.toString());
		windows.push(...buildBaseWindows(date, knobs.weekly, userTz, override));
	}

	const blocks = mergeBlocks([...existingAppointments, ...remoteBusy]);

	const allSlots = windows.flatMap((w) => generateSlots(w, knobs.duration, knobs.slot_granularity));

	return filterSlots(allSlots, { blocks, knobs, now, userTz, perDayCount });
}
