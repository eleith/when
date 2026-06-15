import type { Kysely, Migration } from 'kysely';

export const attendeeTimezone: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').addColumn('attendee_timezone', 'text').execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').dropColumn('attendee_timezone').execute();
	}
};
