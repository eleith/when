import { Temporal } from '@js-temporal/polyfill';
import type { DateOverride, Interval, Weekday, WeeklySchedule } from './types';

const WEEKDAYS: readonly Weekday[] = [
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday'
];

export function weekdayOf(date: Temporal.PlainDate): Weekday {
	return WEEKDAYS[date.dayOfWeek - 1];
}

/** Expand a UTC instant range into the calendar dates that overlap it in `userTz`. */
export function candidateDates(
	rangeStart: Temporal.Instant,
	rangeEnd: Temporal.Instant,
	userTz: string
): Temporal.PlainDate[] {
	if (Temporal.Instant.compare(rangeStart, rangeEnd) > 0) return [];
	const start = rangeStart.toZonedDateTimeISO(userTz).toPlainDate();
	const end = rangeEnd.toZonedDateTimeISO(userTz).toPlainDate();
	const out: Temporal.PlainDate[] = [];
	let d = start;
	while (Temporal.PlainDate.compare(d, end) <= 0) {
		out.push(d);
		d = d.add({ days: 1 });
	}
	return out;
}

const HHMM_RANGE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Build base availability windows for a single calendar date, anchored in `userTz`
 * and returned as UTC instants. DST handling:
 *   - Spring-forward (nonexistent local times): the window is dropped.
 *   - Fall-back (ambiguous local times): Temporal's "compatible" disambiguation
 *     returns the earlier occurrence, matching the spec.
 */
export function buildBaseWindows(
	date: Temporal.PlainDate,
	weekly: WeeklySchedule,
	userTz: string,
	override?: DateOverride
): Interval[] {
	if (override) {
		if ('allDayBlock' in override) return [];
		const interval = parseRange(`${override.window.start}-${override.window.end}`, date, userTz);
		return interval ? [interval] : [];
	}
	const ranges = weekly[weekdayOf(date)] ?? [];
	return ranges.map((r) => parseRange(r, date, userTz)).filter((x): x is Interval => x !== null);
}

function parseRange(range: string, date: Temporal.PlainDate, tz: string): Interval | null {
	const m = HHMM_RANGE.exec(range);
	if (!m) return null;
	const [, sh, sm, eh, em] = m;
	const startTime = new Temporal.PlainTime(Number(sh), Number(sm));
	const endTime = new Temporal.PlainTime(Number(eh), Number(em));
	const start = localToInstant(date, startTime, tz);
	const end = localToInstant(date, endTime, tz);
	if (start === null || end === null) return null;
	if (Temporal.Instant.compare(start, end) >= 0) return null;
	return { start, end };
}

/**
 * Convert a (date, time, tz) tuple to a UTC instant. Returns null if the local
 * time falls in a DST gap (spring forward) and therefore does not exist.
 */
export function localToInstant(
	date: Temporal.PlainDate,
	time: Temporal.PlainTime,
	tz: string
): Temporal.Instant | null {
	const zdt = date.toZonedDateTime({ timeZone: tz, plainTime: time });
	if (!zdt.toPlainTime().equals(time)) return null;
	return zdt.toInstant();
}
