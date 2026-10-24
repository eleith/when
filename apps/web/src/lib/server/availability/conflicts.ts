import type { Kysely } from 'kysely';
import { getBusyIntervals, type Database } from '@when/db';
import { busyCalendarsFor } from '@when/calendar';
import type { Meeting } from '@when/config';
import { overlapsAny } from './intervals';
import type { Interval } from './types';

export async function hasAppointmentConflict(
	db: Kysely<Database>,
	meeting: Meeting,
	interval: Interval,
	excludeAppointmentId: string
): Promise<boolean> {
	// A long appointment can overlap this interval even if it started much earlier.
	const local = await db
		.selectFrom('appointments')
		.select(['start_time', 'end_time'])
		.where('status', 'in', ['pending', 'confirmed'])
		.where('id', '!=', excludeAppointmentId)
		.execute();
	const localIntervals = local.map((row) => ({
		start: Temporal.Instant.from(row.start_time),
		end: Temporal.Instant.from(row.end_time)
	}));
	if (overlapsAny(interval, localIntervals)) return true;

	const remote = await getBusyIntervals(db, busyCalendarsFor(meeting), {
		start: interval.start.toString(),
		end: interval.end.toString()
	});
	const remoteIntervals = remote.map((row) => ({
		start: Temporal.Instant.from(row.start),
		end: Temporal.Instant.from(row.end)
	}));
	return overlapsAny(interval, remoteIntervals);
}
