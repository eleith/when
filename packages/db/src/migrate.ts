import { Migrator, type Kysely } from 'kysely';
import type { Database } from './types.js';
import { migrations } from './migrations/index.js';

/**
 * Apply all pending migrations and return the names that were applied. Stays
 * logger-agnostic so it can run in any app; the caller logs the result.
 */
export async function runMigrations(db: Kysely<Database>): Promise<string[]> {
	const migrator = new Migrator({
		db,
		provider: {
			async getMigrations() {
				return migrations;
			}
		}
	});

	const { error, results } = await migrator.migrateToLatest();
	if (error) throw error instanceof Error ? error : new Error(String(error));
	return (results ?? []).map((r) => r.migrationName);
}
