import { sql, type Kysely, type Migration } from 'kysely';

// A kind with one instance (smtp) carries an empty name: SQLite lets a NULL slip past a
// composite primary key. Copied rows start their streak at the last attempt — the true
// start is unknowable, and this never reads as older than the truth.
export const serviceStatus: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema
			.createTable('service_status')
			.addColumn('kind', 'text', (c) => c.notNull())
			.addColumn('name', 'text', (c) => c.notNull())
			.addColumn('last_attempt_at', 'text')
			.addColumn('last_ok_at', 'text')
			.addColumn('failing_since', 'text')
			.addColumn('error', 'text')
			.addColumn('via', 'text')
			.addPrimaryKeyConstraint('service_status_pk', ['kind', 'name'])
			.execute();

		await sql`
			INSERT INTO service_status (kind, name, last_attempt_at, last_ok_at, failing_since, error, via)
			SELECT 'calendar',
			       calendar_id,
			       last_refresh_at,
			       last_successful_refresh_at,
			       CASE WHEN error IS NOT NULL THEN last_refresh_at END,
			       error,
			       'refresh'
			FROM calendar_sync_status
		`.execute(db);

		await db.schema.dropTable('calendar_sync_status').execute();

		// Its only writer was deleted with the provider rename; nothing has set it since.
		await db.schema.alterTable('oauth_tokens').dropColumn('last_error').execute();
	},

	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('oauth_tokens').addColumn('last_error', 'text').execute();

		await db.schema
			.createTable('calendar_sync_status')
			.addColumn('calendar_id', 'text', (c) => c.primaryKey())
			.addColumn('last_refresh_at', 'text')
			.addColumn('last_successful_refresh_at', 'text')
			.addColumn('error', 'text')
			.execute();

		await sql`
			INSERT INTO calendar_sync_status (calendar_id, last_refresh_at, last_successful_refresh_at, error)
			SELECT name, last_attempt_at, last_ok_at, error
			FROM service_status
			WHERE kind = 'calendar'
		`.execute(db);

		await db.schema.dropTable('service_status').execute();
	}
};
