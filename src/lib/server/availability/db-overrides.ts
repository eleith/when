import type { Kysely } from 'kysely';
import type { Database } from '../db';
import type { DateOverride } from './types';

/**
 * Load availability_overrides rows for the given date range (inclusive,
 * dates are stored as ISO strings in user_tz). Returns a map keyed by
 * `YYYY-MM-DD` date string suitable for passing to `computeSlots`.
 *
 * If both start_time and end_time are null on a row, the day is fully
 * blocked. Otherwise the row defines the only available window for that
 * day.
 */
export async function loadDateOverrides(
	db: Kysely<Database>,
	rangeStart: string,
	rangeEnd: string
): Promise<Map<string, DateOverride>> {
	const rows = await db
		.selectFrom('availability_overrides')
		.select(['date', 'start_time', 'end_time'])
		.where('date', '>=', rangeStart)
		.where('date', '<=', rangeEnd)
		.execute();

	const map = new Map<string, DateOverride>();
	for (const row of rows) {
		if (row.start_time === null || row.end_time === null) {
			map.set(row.date, { allDayBlock: true });
		} else {
			map.set(row.date, { window: { start: row.start_time, end: row.end_time } });
		}
	}
	return map;
}
