import { mergeBlocks } from './intervals';
import { filterSlots } from './filter';
import { generateSlots } from './slots';
import type { AvailabilitySettings, Interval } from './types';
import { buildBaseWindows, candidateDates } from './windows';

export interface ComputeOptions {
	settings: AvailabilitySettings;
	rangeStart: Temporal.Instant;
	rangeEnd: Temporal.Instant;
	userTz: string;
	now: Temporal.Instant;
	/** Active appointments overlapping the range, as UTC intervals. */
	existingAppointments: Interval[];
	/** Remote calendar busy intervals (RRULE-expanded already). */
	remoteBusy: Interval[];
	/** Active-appointment counts keyed by user_tz YYYY-MM-DD. */
	perDayCount: Map<string, number>;
}

export function computeSlots(opts: ComputeOptions): Temporal.Instant[] {
	const {
		settings,
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
		windows.push(...buildBaseWindows(date, settings.weekly, userTz));
	}

	const blocks = mergeBlocks([...existingAppointments, ...remoteBusy]);

	const allSlots = windows.flatMap((w) =>
		generateSlots(w, settings.duration, settings.slot_granularity)
	);

	return filterSlots(allSlots, { blocks, settings, now, userTz, perDayCount });
}
