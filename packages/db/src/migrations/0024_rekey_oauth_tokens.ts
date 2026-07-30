import { sql, type Kysely, type Migration } from 'kysely';

// One Google service backs many calendars, so a calendar-keyed token stored the same
// credential once per calendar. Nothing ever read or wrote this table, so there is no
// data to carry across — drop and recreate at the right grain. Access tokens are cached
// in memory per process and re-minted on demand, so only the refresh token is persisted.
export const rekeyOauthTokens: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema.dropTable('oauth_tokens').execute();
		await db.schema
			.createTable('oauth_tokens')
			.addColumn('service_name', 'text', (c) => c.primaryKey())
			.addColumn('refresh_token', 'text', (c) => c.notNull())
			.addColumn('connected_at', 'text', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
			.addColumn('last_error', 'text')
			.addColumn('updated_at', 'text', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
			.execute();
	},

	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.dropTable('oauth_tokens').execute();
		await db.schema
			.createTable('oauth_tokens')
			.addColumn('calendar_id', 'text', (c) => c.primaryKey())
			.addColumn('access_token', 'text', (c) => c.notNull())
			.addColumn('refresh_token', 'text', (c) => c.notNull())
			.addColumn('expires_at', 'text', (c) => c.notNull())
			.addColumn('updated_at', 'text', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
			.execute();
	}
};
