import { describe, expect, test } from 'vitest';
import { createNotificationTracker } from '$lib/server/booking/side-effects';

describe('createNotificationTracker', () => {
	test('starts unchanged with the given initial status', () => {
		const t = createNotificationTracker(null);
		expect(t.status()).toBe(null);
		expect(t.changed()).toBe(false);
	});

	test('successful side effect leaves status unchanged', async () => {
		const t = createNotificationTracker(null);
		const result = await t.run('email', async () => ({ ok: true as const, payload: 1 }));
		expect(result).toEqual({ ok: true, payload: 1 });
		expect(t.status()).toBe(null);
		expect(t.changed()).toBe(false);
	});

	test('failed side effect records the key as failed', async () => {
		const t = createNotificationTracker(null);
		await t.run('email', async () => ({ ok: false as const, reason: 'smtp' }));
		expect(t.status()).toBe('{"email":"failed"}');
		expect(t.changed()).toBe(true);
	});

	test('multiple failures merge into one status string', async () => {
		const t = createNotificationTracker(null);
		await t.run('calendar_push', async () => ({ ok: false }));
		await t.run('email', async () => ({ ok: false }));
		expect(JSON.parse(t.status() as string)).toEqual({
			calendar_push: 'failed',
			email: 'failed'
		});
	});

	test('preserves prior keys from the initial status', async () => {
		const t = createNotificationTracker('{"calendar_push":"failed"}');
		await t.run('email', async () => ({ ok: false }));
		expect(JSON.parse(t.status() as string)).toEqual({
			calendar_push: 'failed',
			email: 'failed'
		});
		expect(t.changed()).toBe(true);
	});

	test('returns the result of the wrapped fn unchanged', async () => {
		const t = createNotificationTracker(null);
		const okResult = await t.run('email', async () => ({ ok: true as const, value: 'hello' }));
		expect(okResult.value).toBe('hello');
	});
});
