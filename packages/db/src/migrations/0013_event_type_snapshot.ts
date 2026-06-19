import type { Kysely, Migration } from 'kysely';

export const eventTypeSnapshot: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema
			.alterTable('appointments')
			.addColumn('event_type_snapshot', 'text')
			.execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').dropColumn('event_type_snapshot').execute();
	}
};
