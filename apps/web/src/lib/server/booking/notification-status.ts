import type { Appointment, NotificationChannel } from '@when/db';

type StatusColumns = Pick<
	Appointment,
	'email_notification_status' | 'calendar_push_notification_status'
>;

export function notificationFailures(row: StatusColumns): NotificationChannel[] {
	const failures: NotificationChannel[] = [];
	if (row.email_notification_status === 'failed') failures.push('email');
	if (row.calendar_push_notification_status === 'failed') failures.push('calendar_push');
	return failures;
}
