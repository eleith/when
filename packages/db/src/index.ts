import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Kysely } from 'kysely';
import { NodeSqliteDialect } from './node-sqlite-dialect.js';
import type { Database } from './types.js';

export type { Database } from './types.js';
export type {
	AppointmentsTable,
	OauthTokensTable,
	ExternalCalendarBusyTable,
	CalendarSyncStatusTable,
	AppointmentStatus,
	CalendarHealth,
	Appointment,
	NewAppointment,
	AppointmentUpdate,
	ExternalCalendarBusy,
	NewExternalCalendarBusy,
	CalendarSyncStatus,
	NewCalendarSyncStatus,
	CalendarSyncStatusUpdate,
	NotificationOutcome,
	NotificationChannel
} from './types.js';
export { runMigrations } from './migrate.js';
export { migrations } from './migrations/index.js';
export { findAppointment } from './appointments.js';
export {
	replaceCalendarBusy,
	recordRefreshResult,
	listOwnEventIds,
	getBusyIntervals,
	listUpcomingActiveAppointments,
	setPossibleConflicts,
	listOutOfSyncAppointments,
	markSynced,
	recordPublishFailure
} from './calendar-busy.js';
export type {
	BusyInterval,
	RefreshResult,
	UpcomingAppointment,
	MarkSyncedFields
} from './calendar-busy.js';

export function openDb(path: string): Kysely<Database> {
	if (path !== ':memory:') {
		mkdirSync(dirname(path), { recursive: true });
	}
	const sqlite = new DatabaseSync(path);
	sqlite.exec('PRAGMA journal_mode = WAL');
	sqlite.exec('PRAGMA foreign_keys = ON');
	sqlite.exec('PRAGMA busy_timeout = 5000');
	return new Kysely<Database>({
		dialect: new NodeSqliteDialect({ database: sqlite })
	});
}
