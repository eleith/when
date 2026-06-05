import { describe, expect, test } from 'vitest';
import { notificationStates } from './notifications';

describe('notificationStates', () => {
	test('empty when both channels are ok or null', () => {
		expect(
			notificationStates({
				email_notification_status: 'ok',
				calendar_push_notification_status: null
			})
		).toEqual([]);
	});

	test('reports queued and failed channels, in channel order', () => {
		expect(
			notificationStates({
				email_notification_status: 'queued',
				calendar_push_notification_status: 'failed'
			})
		).toEqual([
			{ channel: 'email', state: 'queued' },
			{ channel: 'calendar_push', state: 'failed' }
		]);
	});

	test('a single failed channel', () => {
		expect(
			notificationStates({
				email_notification_status: 'failed',
				calendar_push_notification_status: 'ok'
			})
		).toEqual([{ channel: 'email', state: 'failed' }]);
	});
});
