import { sql, type Kysely, type Migration } from 'kysely';

export const calendarMirrorTables: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema
			.createTable('external_calendar_busy')
			.addColumn('id', 'integer', (c) => c.primaryKey())
			.addColumn('calendar_id', 'text', (c) => c.notNull())
			.addColumn('start_time', 'text', (c) => c.notNull())
			.addColumn('end_time', 'text', (c) => c.notNull())
			.execute();

		await db.schema
			.createIndex('external_calendar_busy_range')
			.on('external_calendar_busy')
			.columns(['calendar_id', 'end_time', 'start_time'])
			.execute();

		await db.schema
			.createTable('calendar_sync_status')
			.addColumn('calendar_id', 'text', (c) => c.primaryKey())
			.addColumn('last_refresh_at', 'text')
			.addColumn('last_successful_refresh_at', 'text')
			.addColumn('error', 'text')
			.addColumn('health', 'text', (c) => c.notNull().defaultTo(sql`'unknown'`))
			.addColumn('health_changed_at', 'text')
			.addColumn('health_reason', 'text')
			.execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.dropTable('calendar_sync_status').execute();
		await db.schema.dropTable('external_calendar_busy').execute();
	}
};
