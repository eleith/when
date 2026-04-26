import { Database as BunSqlite } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Kysely } from 'kysely';
import { BunSqliteDialect } from 'kysely-bun-sqlite';
import type { Database } from './types';

export type { Database } from './types';
export type {
	AppointmentsTable,
	OauthTokensTable,
	AvailabilityOverridesTable,
	AppointmentStatus,
	Appointment,
	NewAppointment,
	AppointmentUpdate,
	AvailabilityOverride,
	NewAvailabilityOverride
} from './types';

export function openDb(path: string): Kysely<Database> {
	if (path !== ':memory:') {
		mkdirSync(dirname(path), { recursive: true });
	}
	const sqlite = new BunSqlite(path, { create: true });
	sqlite.exec('PRAGMA journal_mode = WAL');
	sqlite.exec('PRAGMA foreign_keys = ON');
	return new Kysely<Database>({
		dialect: new BunSqliteDialect({ database: sqlite })
	});
}
