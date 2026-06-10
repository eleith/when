import type { Kysely } from 'kysely';
import type { Database } from './types.js';

export interface BusyInterval {
	start: string;
	end: string;
}

export async function replaceCalendarBusy(
	db: Kysely<Database>,
	calendarId: string,
	intervals: BusyInterval[]
): Promise<void> {
	await db.transaction().execute(async (tx) => {
		await tx.deleteFrom('external_calendar_busy').where('calendar_id', '=', calendarId).execute();
		if (intervals.length === 0) return;
		await tx
			.insertInto('external_calendar_busy')
			.values(
				intervals.map((i) => ({ calendar_id: calendarId, start_time: i.start, end_time: i.end }))
			)
			.execute();
	});
}

export interface RefreshResult {
	at: string;
	error?: string | null;
}

export async function recordRefreshResult(
	db: Kysely<Database>,
	calendarId: string,
	result: RefreshResult
): Promise<void> {
	const ok = !result.error;
	await db
		.insertInto('calendar_sync_status')
		.values({
			calendar_id: calendarId,
			last_refresh_at: result.at,
			last_successful_refresh_at: ok ? result.at : null,
			error: ok ? null : result.error
		})
		.onConflict((oc) =>
			oc
				.column('calendar_id')
				.doUpdateSet(
					ok
						? { last_refresh_at: result.at, last_successful_refresh_at: result.at, error: null }
						: { last_refresh_at: result.at, error: result.error }
				)
		)
		.execute();
}

// Our own published events come back from the provider as "busy"; the refresh
// drops them by matching the external_event_id we stored. Cancelled rows whose
// event hasn't been deleted yet are included so they don't block others.
export async function listOwnEventIds(db: Kysely<Database>, calendarId: string): Promise<string[]> {
	const rows = await db
		.selectFrom('appointments')
		.select('external_event_id')
		.where('external_calendar_id', '=', calendarId)
		.where('external_event_id', 'is not', null)
		.execute();
	return rows.map((r) => r.external_event_id).filter((id): id is string => id !== null);
}
