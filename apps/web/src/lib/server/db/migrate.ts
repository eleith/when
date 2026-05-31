import { Migrator, type Kysely } from 'kysely';
import type { Database } from './types';
import { migrations } from './migrations';
import { logger } from '../logger';

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
	const names = (results ?? []).map((r) => r.migrationName);
	if (names.length > 0) {
		logger.info({ migrations: names }, 'migrations applied');
	}
	return names;
}
