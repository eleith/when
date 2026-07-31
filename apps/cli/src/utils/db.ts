import { existsSync } from 'node:fs';
import type { WhenConfiguration } from '@when/config';
import { migrationStatus, openDb } from '@when/db';
import { fail, detail } from './report.ts';

// Kysely stays out of the CLI's imports; the handle is whatever openDb hands back.
export type AppDatabase = ReturnType<typeof openDb>;

/**
 * The app database, for commands that read or record state. Never opened eagerly:
 * `openDb` creates the file and its parent directory, so a command that merely wants to
 * report would otherwise bring into existence the thing it is reporting on.
 *
 * Refuses a schema the CLI does not understand, rather than letting a query fail somewhere
 * downstream with `no such table`. Web and the worker migrate at boot; this says so.
 */
export async function openAppDb(config: WhenConfiguration): Promise<AppDatabase | null> {
	const path = config.database.app;
	if (!existsSync(path)) {
		fail(`no database at ${path}`);
		detail('run when-cli db migrate, or start the app once');
		return null;
	}

	const db = openDb(path);
	const { pending } = await migrationStatus(db);
	if (pending.length > 0) {
		fail(`database schema is behind by ${pending.length} migration(s)`);
		detail('run when-cli db migrate');
		await db.destroy();
		return null;
	}
	return db;
}

/** The one caller allowed to create the database: `db migrate` itself. */
export function openAppDbForMigration(config: WhenConfiguration): AppDatabase {
	return openDb(config.database.app);
}
