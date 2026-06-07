import type { Kysely, Migration } from 'kysely';

export const responseToken: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').addColumn('response_token', 'text').execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').dropColumn('response_token').execute();
	}
};
