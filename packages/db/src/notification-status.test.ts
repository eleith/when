import { expect, test } from 'vitest';
import { parseNotificationStatus } from './notification-status';

test('parses null as empty', () => {
	expect(parseNotificationStatus(null)).toEqual({});
});

test('parses valid JSON object', () => {
	expect(parseNotificationStatus('{"email":"failed"}')).toEqual({ email: 'failed' });
});

test('parses garbage as empty', () => {
	expect(parseNotificationStatus('not json')).toEqual({});
});

test('parses non-object JSON as empty', () => {
	expect(parseNotificationStatus('"failed"')).toEqual({});
});
