import { sql, type Kysely, type Migration } from 'kysely';

// Split the single JSON notification_status column into one typed column per
// channel, so web and worker write a typed value rather than a shared JSON shape.
export const notificationStatusColumns: Migration = {
	async up(db: Kysely<unknown>): Promise<void> {
		await db.schema
			.alterTable('appointments')
			.addColumn('email_notification_status', 'text')
			.execute();
		await db.schema
			.alterTable('appointments')
			.addColumn('calendar_push_notification_status', 'text')
			.execute();
		await sql`
			UPDATE appointments SET
				email_notification_status = json_extract(notification_status, '$.email'),
				calendar_push_notification_status = json_extract(notification_status, '$.calendar_push')
			WHERE notification_status IS NOT NULL
		`.execute(db);
		await db.schema.alterTable('appointments').dropColumn('notification_status').execute();
	},
	async down(db: Kysely<unknown>): Promise<void> {
		await db.schema.alterTable('appointments').addColumn('notification_status', 'text').execute();
		await sql`
			UPDATE appointments SET notification_status = (
				SELECT json_group_object(key, value) FROM (
					SELECT 'email' AS key, email_notification_status AS value
					UNION ALL
					SELECT 'calendar_push', calendar_push_notification_status
				) WHERE value IS NOT NULL
			)
			WHERE email_notification_status IS NOT NULL OR calendar_push_notification_status IS NOT NULL
		`.execute(db);
		await db.schema
			.alterTable('appointments')
			.dropColumn('calendar_push_notification_status')
			.execute();
		await db.schema.alterTable('appointments').dropColumn('email_notification_status').execute();
	}
};
