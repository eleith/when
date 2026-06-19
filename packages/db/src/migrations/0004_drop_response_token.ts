import type { Kysely, Migration } from 'kysely';

// Organizer accept/decline moved from one-click token links to the login-gated
// /appointment/[id] detail page, so the per-booking response_token is no longer used.
export const dropResponseToken: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').dropColumn('response_token').execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').addColumn('response_token', 'text').execute();
	}
};
