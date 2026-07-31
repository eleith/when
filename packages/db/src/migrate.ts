import { Migrator, type Kysely } from 'kysely';
import type { Database } from './types.js';
import { migrations } from './migrations/index.js';

function migrator(db: Kysely<Database>): Migrator {
	return new Migrator({
		db,
		provider: {
			async getMigrations() {
				return migrations;
			}
		}
	});
}

/**
 * Apply all pending migrations and return the names that were applied. Stays
 * logger-agnostic so it can run in any app; the caller logs the result.
 */
export async function runMigrations(db: Kysely<Database>): Promise<string[]> {
	const { error, results } = await migrator(db).migrateToLatest();
	if (error) throw error instanceof Error ? error : new Error(String(error));
	return (results ?? []).map((r) => r.migrationName);
}

export interface MigrationStatus {
	applied: string[];
	pending: string[];
}

/** What `runMigrations` would do, without doing it. */
export async function migrationStatus(db: Kysely<Database>): Promise<MigrationStatus> {
	const known = await migrator(db).getMigrations();
	return {
		applied: known.filter((m) => m.executedAt !== undefined).map((m) => m.name),
		pending: known.filter((m) => m.executedAt === undefined).map((m) => m.name)
	};
}
