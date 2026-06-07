import type { Temporal } from '@js-temporal/polyfill';
import type { IcsRecurrenceRule } from 'ts-ics';

/**
 * A "busy" event from a remote calendar, normalized into Temporal Instants.
 * Represents either a one-shot event, the master of a recurring series
 * (when {@link rrule} is set), or a single-occurrence override (when
 * {@link recurrenceId} is set, identifying which occurrence of `uid` is
 * being replaced).
 */
export interface BusyEvent {
	uid: string;
	start: Temporal.Instant;
	end: Temporal.Instant;
	rrule?: IcsRecurrenceRule;
	exdates?: Temporal.Instant[];
	recurrenceId?: Temporal.Instant;
}

/** A UTC time interval (busy block or availability window). */
export interface Interval {
	start: Temporal.Instant;
	end: Temporal.Instant;
}
