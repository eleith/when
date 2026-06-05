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
	AppointmentStatus,
	Appointment,
	NewAppointment,
	AppointmentUpdate,
	NotificationOutcome,
	NotificationChannel
} from './types.js';
export { runMigrations } from './migrate.js';
export { migrations } from './migrations.js';

export function openDb(path: string): Kysely<Database> {
	if (path !== ':memory:') {
		mkdirSync(dirname(path), { recursive: true });
	}
	const sqlite = new DatabaseSync(path);
	sqlite.exec('PRAGMA journal_mode = WAL');
	sqlite.exec('PRAGMA foreign_keys = ON');
	return new Kysely<Database>({
		dialect: new NodeSqliteDialect({ database: sqlite })
	});
}
