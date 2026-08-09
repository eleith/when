import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Kysely } from 'kysely';
import { NodeSqliteDialect } from './node-sqlite-dialect.js';
import type { Database } from './types.js';

export * from './types.js';
export * from './appointments.js';
export * from './calendar-busy.js';
export * from './service-status.js';
export * from './migrate.js';
export * from './migrations/index.js';

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
