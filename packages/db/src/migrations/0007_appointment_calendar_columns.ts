import { sql, type Kysely, type Migration } from 'kysely';

export const appointmentCalendarColumns: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema
			.alterTable('appointments')
			.addColumn('calendar_revision', 'integer', (c) => c.notNull().defaultTo(0))
			.execute();
		await db.schema
			.alterTable('appointments')
			.addColumn('calendar_synced_revision', 'integer')
			.execute();
		await db.schema
			.alterTable('appointments')
			.addColumn('has_possible_conflict', 'integer', (c) => c.notNull().defaultTo(0))
			.execute();
		await db.schema
			.alterTable('appointments')
			.addColumn('calendar_push_failing_since', 'text')
			.execute();

		// Already-published rows are in sync; mark them so the first calendar sync
		// doesn't treat every existing appointment as out-of-sync and re-push them
		// all. Never-published rows keep synced = NULL for the worker to handle.
		await sql`
			UPDATE appointments
			SET calendar_synced_revision = calendar_revision
			WHERE external_event_id IS NOT NULL
		`.execute(db);
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').dropColumn('calendar_push_failing_since').execute();
		await db.schema.alterTable('appointments').dropColumn('has_possible_conflict').execute();
		await db.schema.alterTable('appointments').dropColumn('calendar_synced_revision').execute();
		await db.schema.alterTable('appointments').dropColumn('calendar_revision').execute();
	}
};
