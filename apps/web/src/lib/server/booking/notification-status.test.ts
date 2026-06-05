import { expect, test } from 'vitest';
import { notificationFailures } from './notification-status';

test('no failures when both channels are ok or null', () => {
	expect(
		notificationFailures({
			email_notification_status: 'ok',
			calendar_push_notification_status: null
		})
	).toEqual([]);
});

test('reports a failed email channel', () => {
	expect(
		notificationFailures({
			email_notification_status: 'failed',
			calendar_push_notification_status: 'ok'
		})
	).toEqual(['email']);
});

test('reports both failed channels in order', () => {
	expect(
		notificationFailures({
			email_notification_status: 'failed',
			calendar_push_notification_status: 'failed'
		})
	).toEqual(['email', 'calendar_push']);
});
