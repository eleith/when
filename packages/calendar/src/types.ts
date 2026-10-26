/** A UTC time interval (busy block or availability window). */
export interface Interval {
	start: Temporal.Instant;
	end: Temporal.Instant;
}

/** Half-open window requested from a calendar provider. */
export type BusyWindow = Interval;

/** One concrete occurrence. uid is the CalDAV UID or Google event ID used for own-event exclusion. */
export interface BusyEvent extends Interval {
	uid: string;
}
