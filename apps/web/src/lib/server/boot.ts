import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeAuth } from './auth';
import { requireAuthSecret } from './auth/secret';
import { setState } from './state';
import { bootConfig } from './config/boot';
import { loadEncryptionKey } from './crypto';
import { openDb, runMigrations } from '@when/db';
import { logger } from './logger';
import { env } from '$env/dynamic/private';

export function defaultDbPath(): string {
	if (process.env.NODE_ENV === 'production') return '/app/data/when.sqlite';
	if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;

	const localPath = join(process.cwd(), 'data', 'when.sqlite');
	const parentDir = join(process.cwd(), '..', '..', 'data');
	if (!existsSync(localPath) && existsSync(parentDir)) {
		return join(parentDir, 'when.sqlite');
	}
	return localPath;
}

export async function bootApp(): Promise<void> {
	requireAuthSecret();
	const config = await bootConfig();
	const rawKey = env.ENCRYPTION_KEY;
	if (!rawKey) throw new Error('ENCRYPTION_KEY env var is required');
	await loadEncryptionKey(rawKey);
	const dbPath = process.env.DATABASE_PATH ?? defaultDbPath();
	const db = openDb(dbPath);
	const applied = await runMigrations(db);
	if (applied.length > 0) logger.info({ migrations: applied }, 'migrations applied');
	makeAuth(config);
	setState({ config, db });
}
