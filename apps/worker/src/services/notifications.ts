import { sql, type Kysely } from 'kysely';
import type { Database, NotificationOutcome, NotificationStatus } from '@when/db';

/**
 * Record one notification outcome on an appointment, merging into
 * `notification_status` via an atomic `json_set` (sibling keys stay intact).
 * App-local, like web's `recordNotificationFailure` — the worker owns its
 * queries; `@when/db` stays schema + types.
 */
export async function setNotificationStatus(
	db: Kysely<Database>,
	id: string,
	key: keyof NotificationStatus,
	outcome: NotificationOutcome
): Promise<void> {
	await db
		.updateTable('appointments')
		.set({
			notification_status: sql`json_set(coalesce(notification_status, '{}'), ${'$.' + key}, ${outcome})`
		})
		.where('id', '=', id)
		.execute();
}
