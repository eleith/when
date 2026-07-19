import type { Weekday } from '@when/config';
export type { Weekday };

/** A wall-clock availability window, HH:MM in the owner's timezone. */
export interface TimeRange {
	from: string;
	to: string;
}

/** Availability windows per weekday, expanded from the config's rule list. */
export type WeeklySchedule = Partial<Record<Weekday, TimeRange[]>>;

/** A UTC time interval. Used for both base windows and blocks. */
export interface Interval {
	start: Temporal.Instant;
	end: Temporal.Instant;
}

/** Availability settings an event type cares about, with globals already merged in. */
export interface AvailabilitySettings {
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
	max_appointments_per_day: number | null;
	weekly: WeeklySchedule;
}
