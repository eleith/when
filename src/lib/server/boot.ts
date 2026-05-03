import { join } from 'node:path';
import { makeAuth } from './auth';
import { requireAuthSecret } from './auth/secret';
import { setState } from './state';
import { bootConfig } from './config/boot';
import { loadEncryptionKey } from './crypto';
import { openDb } from './db';
import { runMigrations } from './db/migrate';
import { env } from '$env/dynamic/private';

export function defaultDbPath(): string {
	if (process.env.NODE_ENV === 'production') return '/app/data/when.sqlite';
	return join(process.cwd(), 'data', 'when.sqlite');
}

export async function bootApp(): Promise<void> {
	requireAuthSecret();
	const config = await bootConfig();
	const rawKey = env.ENCRYPTION_KEY;
	if (!rawKey) throw new Error('ENCRYPTION_KEY env var is required');
	await loadEncryptionKey(rawKey);
	const dbPath = process.env.DATABASE_PATH ?? defaultDbPath();
	const db = openDb(dbPath);
	await runMigrations(db);
	makeAuth(config);
	setState({ config, db });
}
