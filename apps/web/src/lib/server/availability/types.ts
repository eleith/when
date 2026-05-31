import type { Temporal } from '@js-temporal/polyfill';

export type Weekday =
	| 'monday'
	| 'tuesday'
	| 'wednesday'
	| 'thursday'
	| 'friday'
	| 'saturday'
	| 'sunday';

export interface WeeklySchedule {
	monday?: string[];
	tuesday?: string[];
	wednesday?: string[];
	thursday?: string[];
	friday?: string[];
	saturday?: string[];
	sunday?: string[];
}

/** A UTC time interval. Used for both base windows and blocks. */
export interface Interval {
	start: Temporal.Instant;
	end: Temporal.Instant;
}

/** Knobs an event type cares about, with globals already merged in. */
export interface EventTypeKnobs {
	/** minutes */
	duration: number;
	/** minutes */
	slot_granularity: number;
	/** minutes */
	minimum_notice: number;
	/** days */
	maximum_lookahead: number;
	/** minutes */
	buffer_before: number;
	/** minutes */
	buffer_after: number;
	/** appointments per `user_tz` calendar day; null = unlimited */
	max_bookings_per_day: number | null;
	weekly: WeeklySchedule;
}
