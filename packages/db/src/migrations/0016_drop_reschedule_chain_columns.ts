import type { Kysely, Migration } from 'kysely';

export const dropRescheduleChainColumns: Migration = {
	async up(db: Kysely<unknown>) {
		await db.schema.alterTable('appointments').dropColumn('rescheduled_from_id').execute();
		await db.schema.alterTable('appointments').dropColumn('rescheduled_to_id').execute();
	},
	async down(db: Kysely<unknown>) {
		await db.schema.alterTable('appointments').addColumn('rescheduled_from_id', 'text').execute();
		await db.schema.alterTable('appointments').addColumn('rescheduled_to_id', 'text').execute();
	}
};
