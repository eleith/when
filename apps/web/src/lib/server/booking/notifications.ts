import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database, NotificationStatus } from '@when/db';

export type NotificationFailureKey = keyof NotificationStatus;

/**
 * Record a notification failure directly in SQLite.
 * Uses atomic json_set to update the notification_status column.
 */
export async function recordNotificationFailure(
	db: Kysely<Database>,
	id: string,
	key: NotificationFailureKey
): Promise<void> {
	await db
		.updateTable('appointments')
		.set({
			notification_status: sql`json_set(coalesce(notification_status, '{}'), ${'$.' + key}, 'failed')`
		})
		.where('id', '=', id)
		.execute();
}
