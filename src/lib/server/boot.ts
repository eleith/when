import { join } from 'node:path';
import { type Kysely } from 'kysely';
import { makeAuth } from './auth';
import { requireAuthSecret } from './auth/secret';
import { setState } from './state';
import { bootConfig } from './config/boot';
import type { WhenConfiguration } from './config/schema';
import { loadEncryptionKey } from './crypto';
import { openDb, type Database } from './db';
import { runMigrations } from './db/migrate';
import { logger } from './logger';

export interface BootResult {
	config: WhenConfiguration;
	db: Kysely<Database>;
	encryptionKey: CryptoKey;
}

export function defaultDbPath(): string {
	if (process.env.NODE_ENV === 'production') return '/app/data/when.sqlite';
	return join(process.cwd(), 'data', 'when.sqlite');
}

export async function bootApp(): Promise<BootResult> {
	requireAuthSecret();
	const config = await bootConfig();
	const encryptionKey = await loadEncryptionKey();
	const dbPath = process.env.DATABASE_PATH ?? defaultDbPath();
	const db = openDb(dbPath);
	const applied = await runMigrations(db);
	logger.info({ db: dbPath, migrations: applied }, 'migrations applied');
	makeAuth(config);
	setState({ config, db, encryptionKey });
	return { config, db, encryptionKey };
}
