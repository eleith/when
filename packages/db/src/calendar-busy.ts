import { sql, type Kysely } from 'kysely';
import type { Appointment, CalendarSyncStatus, Database } from './types.js';

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

export async function getBusyIntervals(
	db: Kysely<Database>,
	calendarIds: string[],
	window: BusyInterval
): Promise<BusyInterval[]> {
	if (calendarIds.length === 0) return [];
	const rows = await db
		.selectFrom('external_calendar_busy')
		.select(['start_time', 'end_time'])
		.where('calendar_id', 'in', calendarIds)
		.where('end_time', '>', window.start)
		.where('start_time', '<', window.end)
		.execute();
	return rows.map((r) => ({ start: r.start_time, end: r.end_time }));
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

export interface UpcomingAppointment {
	id: string;
	event_type_id: string;
	start_time: string;
	end_time: string;
}

export async function listUpcomingActiveAppointments(
	db: Kysely<Database>,
	now: string
): Promise<UpcomingAppointment[]> {
	return db
		.selectFrom('appointments')
		.select(['id', 'event_type_id', 'start_time', 'end_time'])
		.where('end_time', '>=', now)
		.where('status', 'in', ['pending', 'confirmed'])
		.execute();
}

export async function setPossibleConflicts(
	db: Kysely<Database>,
	flaggedIds: string[],
	clearedIds: string[]
): Promise<void> {
	if (flaggedIds.length > 0) {
		await db
			.updateTable('appointments')
			.set({ has_possible_conflict: 1 })
			.where('id', 'in', flaggedIds)
			.execute();
	}
	if (clearedIds.length > 0) {
		await db
			.updateTable('appointments')
			.set({ has_possible_conflict: 0 })
			.where('id', 'in', clearedIds)
			.execute();
	}
}

// Stale = the calendar doesn't reflect the current row. `is not` is SQLite's
// null-safe comparison, so a never-synced row (synced NULL) counts as stale.
export async function listOutOfSyncAppointments(db: Kysely<Database>): Promise<Appointment[]> {
	return db
		.selectFrom('appointments')
		.selectAll()
		.where(sql<boolean>`calendar_revision is not calendar_synced_revision`)
		.where('status', '!=', 'purged')
		.execute();
}

export interface MarkSyncedFields {
	external_event_id?: string | null;
	external_calendar_id?: string | null;
}

export async function markSynced(
	db: Kysely<Database>,
	id: string,
	revision: number,
	fields: MarkSyncedFields = {}
): Promise<void> {
	await db
		.updateTable('appointments')
		.set({ calendar_synced_revision: revision, ...fields })
		.where('id', '=', id)
		.execute();
}

export function listCalendarSyncStatus(db: Kysely<Database>): Promise<CalendarSyncStatus[]> {
	return db.selectFrom('calendar_sync_status').selectAll().execute();
}
