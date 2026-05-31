import { expect, test } from 'vitest';
import { mergeNotificationStatus, parseNotificationStatus } from './notification-status';

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

test('merge into null produces patch', () => {
	expect(mergeNotificationStatus(null, { email: 'failed' })).toBe('{"email":"failed"}');
});

test('merge preserves earlier failures across channels', () => {
	const merged = mergeNotificationStatus('{"email":"failed"}', { calendar_push: 'failed' });
	expect(JSON.parse(merged)).toEqual({ email: 'failed', calendar_push: 'failed' });
});

test('merge overwrites the same key', () => {
	const merged = mergeNotificationStatus('{"email":"failed"}', { email: 'ok' });
	expect(JSON.parse(merged)).toEqual({ email: 'ok' });
});
