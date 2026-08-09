import { sql, type Kysely, type Migration } from 'kysely';

// The refresh token moved into when.yaml; nothing reads this table now.
export const dropOauthTokens: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema.dropTable('oauth_tokens').execute();
	},

	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema
			.createTable('oauth_tokens')
			.addColumn('provider_name', 'text', (c) => c.primaryKey())
			.addColumn('refresh_token', 'text', (c) => c.notNull())
			.addColumn('connected_at', 'text', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
			.addColumn('updated_at', 'text', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
			.execute();
	}
};
