import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Kysely } from 'kysely';
import { NodeSqliteDialect } from './node-sqlite-dialect';
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
