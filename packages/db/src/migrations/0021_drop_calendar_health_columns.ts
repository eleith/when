import type { Kysely, Migration } from 'kysely';

export const dropCalendarHealthColumns: Migration = {
	async up(db: Kysely<unknown>) {
		await db.schema.alterTable('calendar_sync_status').dropColumn('health').execute();
		await db.schema.alterTable('calendar_sync_status').dropColumn('health_changed_at').execute();
		await db.schema.alterTable('calendar_sync_status').dropColumn('health_reason').execute();
	},
	async down(db: Kysely<unknown>) {
		await db.schema
			.alterTable('calendar_sync_status')
			.addColumn('health', 'text', (c) => c.notNull().defaultTo('unknown'))
			.addColumn('health_changed_at', 'text')
			.addColumn('health_reason', 'text')
			.execute();
	}
};
