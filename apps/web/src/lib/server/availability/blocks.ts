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
 *
 * The two results are scoped differently on purpose: `appointments` spans every
 * meeting type, because an appointment occupies the host no matter which type
 * booked it, while `perDayCount` counts only `eventTypeId` — `daily_booking_limit`
 * is configured on the meeting type, so it limits that type alone.
 *
 * `excludeStart` drops the appointment already sitting at that instant on this
 * meeting type, so a reschedule can land back on its own slot. It does not
 * adjust `perDayCount`.
 */
export async function loadAppointmentBlocks(
	db: Kysely<Database>,
	eventTypeId: string,
	rangeStart: Temporal.Instant,
	rangeEnd: Temporal.Instant,
	userTz: string,
	excludeStart: string | null = null
): Promise<DbBlocksResult> {
	const queryStart = rangeStart.subtract({ hours: 24 });
	const queryEnd = rangeEnd.add({ hours: 24 });

	const rows = await db
		.selectFrom('appointments')
		.select(['start_time', 'end_time', 'event_type_id'])
		.where('status', 'in', ['pending', 'confirmed'])
		.where('start_time', '>=', queryStart.toString())
		.where('start_time', '<=', queryEnd.toString())
		.execute();

	const appointments: Interval[] = rows
		.filter((r) => !(r.event_type_id === eventTypeId && r.start_time === excludeStart))
		.map((r) => ({
			start: Temporal.Instant.from(r.start_time),
			end: Temporal.Instant.from(r.end_time)
		}));

	const perDayCount = new Map<string, number>();
	for (const r of rows) {
		if (r.event_type_id !== eventTypeId) continue;
		const day = Temporal.Instant.from(r.start_time)
			.toZonedDateTimeISO(userTz)
			.toPlainDate()
			.toString();
		perDayCount.set(day, (perDayCount.get(day) ?? 0) + 1);
	}

	return { appointments, perDayCount };
}
