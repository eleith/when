import { join } from 'node:path';
import { type Kysely } from 'kysely';
import { bootConfig } from './config/boot';
import type { WhenConfiguration } from './config/schema';
import { openDb, type Database } from './db';
import { runMigrations } from './db/migrate';
import { logger } from './logger';

export interface BootResult {
	config: WhenConfiguration;
	db: Kysely<Database>;
}

export function defaultDbPath(): string {
	if (process.env.NODE_ENV === 'production') return '/app/data/when.sqlite';
	return join(process.cwd(), 'data', 'when.sqlite');
}

export async function bootApp(): Promise<BootResult> {
	const config = await bootConfig();
	const dbPath = process.env.DATABASE_PATH ?? defaultDbPath();
	const db = openDb(dbPath);
	const applied = await runMigrations(db);
	logger.info({ db: dbPath, migrations: applied }, 'migrations applied');
	return { config, db };
}
