import { type Kysely } from 'kysely';
import type {
	AppointmentUpdate,
	Database,
	NotificationChannel,
	NotificationOutcome
} from '@when/db';

export async function setNotificationStatus(
	db: Kysely<Database>,
	id: string,
	channel: NotificationChannel,
	outcome: NotificationOutcome
): Promise<void> {
	const patch: AppointmentUpdate =
		channel === 'email'
			? { email_notification_status: outcome }
			: { calendar_push_notification_status: outcome };

	await db.updateTable('appointments').set(patch).where('id', '=', id).execute();
}
