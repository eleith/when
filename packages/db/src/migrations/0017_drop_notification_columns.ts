import type { Kysely, Migration } from 'kysely';

export const dropNotificationColumns: Migration = {
	async up(db: Kysely<unknown>) {
		await db.schema.alterTable('appointments').dropColumn('email_notification_status').execute();
		await db.schema
			.alterTable('appointments')
			.dropColumn('calendar_push_notification_status')
			.execute();
		await db.schema.alterTable('appointments').dropColumn('calendar_push_failing_since').execute();
	},
	async down(db: Kysely<unknown>) {
		await db.schema
			.alterTable('appointments')
			.addColumn('email_notification_status', 'text')
			.execute();
		await db.schema
			.alterTable('appointments')
			.addColumn('calendar_push_notification_status', 'text')
			.execute();
		await db.schema
			.alterTable('appointments')
			.addColumn('calendar_push_failing_since', 'text')
			.execute();
	}
};
