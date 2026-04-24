import { Database as BunSqlite } from 'bun:sqlite';
import { Kysely } from 'kysely';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import type { Database } from './types';

export type { Database } from './types';
export type {
	AppointmentsTable,
	OauthTokensTable,
	AppointmentStatus,
	Appointment,
	NewAppointment,
	AppointmentUpdate
} from './types';

export function openDb(path: string): Kysely<Database> {
	const sqlite = new BunSqlite(path, { create: true });
	sqlite.exec('PRAGMA journal_mode = WAL');
	sqlite.exec('PRAGMA foreign_keys = ON');
	return new Kysely<Database>({
		dialect: new BunSqliteDialect({ database: sqlite })
	});
}
