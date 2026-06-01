import { Temporal } from '@js-temporal/polyfill';
import type { Kysely } from 'kysely';
import type { Database } from '@when/db';
import type { Interval } from './types';

export interface DbBlocksResult {
	appointments: Interval[];
	perDayCount: Map<string, number>;
}

/**
 * Load active (pending/confirmed) appointments overlapping the requested
 * range ± 1 day margin, returning UTC intervals plus per-user_tz-day counts.
 */
export async function loadAppointmentBlocks(
	db: Kysely<Database>,
	eventTypeId: string,
	rangeStart: Temporal.Instant,
	rangeEnd: Temporal.Instant,
	userTz: string
): Promise<DbBlocksResult> {
	const queryStart = rangeStart.subtract({ hours: 24 });
	const queryEnd = rangeEnd.add({ hours: 24 });

	const rows = await db
		.selectFrom('appointments')
		.select(['start_time', 'end_time'])
		.where('event_type_id', '=', eventTypeId)
		.where('status', 'in', ['pending', 'confirmed'])
		.where('start_time', '>=', queryStart.toString())
		.where('start_time', '<=', queryEnd.toString())
		.execute();

	const appointments: Interval[] = rows.map((r) => ({
		start: Temporal.Instant.from(r.start_time),
		end: Temporal.Instant.from(r.end_time)
	}));

	const perDayCount = new Map<string, number>();
	for (const a of appointments) {
		const day = a.start.toZonedDateTimeISO(userTz).toPlainDate().toString();
		perDayCount.set(day, (perDayCount.get(day) ?? 0) + 1);
	}

	return { appointments, perDayCount };
}
