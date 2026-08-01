import { sql, type Kysely, type Migration } from 'kysely';

// `config.services` are providers, so the column naming one follows. SQLite has
// RENAME COLUMN, which keeps the rows and the primary key in place.
export const renameServiceName: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await sql`ALTER TABLE oauth_tokens RENAME COLUMN service_name TO provider_name`.execute(db);
	},

	async down(db: Kysely<unknown>): Promise<void> {
		await sql`ALTER TABLE oauth_tokens RENAME COLUMN provider_name TO service_name`.execute(db);
	}
};
