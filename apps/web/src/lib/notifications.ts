export type NotificationChannel = 'email' | 'calendar_push';
export type NotificationState = 'queued' | 'failed';

export interface ChannelNotification {
	channel: NotificationChannel;
	state: NotificationState;
}

// 'ok' and 'skipped' are terminal non-alarming states; only queued/failed surface.
type ChannelStatus = NotificationState | 'ok' | 'skipped' | null;

interface StatusColumns {
	email_notification_status: ChannelStatus;
	calendar_push_notification_status: ChannelStatus;
}

export function notificationStates(row: StatusColumns): ChannelNotification[] {
	const states: ChannelNotification[] = [];
	const email = row.email_notification_status;
	if (email === 'queued' || email === 'failed') states.push({ channel: 'email', state: email });
	const calendar = row.calendar_push_notification_status;
	if (calendar === 'queued' || calendar === 'failed') {
		states.push({ channel: 'calendar_push', state: calendar });
	}
	return states;
}
