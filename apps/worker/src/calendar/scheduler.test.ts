import { afterEach, expect, test, vi } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import { createRefreshScheduler, refreshIntervalMinutes } from './scheduler.js';

afterEach(() => vi.useRealTimers());

test('refreshIntervalMinutes takes the min across conflict calendars, default 10', () => {
	const config = {
		calendars: [
			{ id: 'a', sync: { refresh_interval: 30 } },
			{ id: 'b', sync: { refresh_interval: 5 } },
			{ id: 'c' }
		],
		event_types: [{ conflict_calendars: ['a', 'b', 'c'] }]
	} as unknown as WhenConfiguration;
	expect(refreshIntervalMinutes(config)).toBe(5);
});

test('refreshIntervalMinutes ignores non-conflict calendars', () => {
	const config = {
		calendars: [
			{ id: 'a', sync: { refresh_interval: 3 } },
			{ id: 'b', sync: { refresh_interval: 30 } }
		],
		event_types: [{ conflict_calendars: ['b'] }]
	} as unknown as WhenConfiguration;
	expect(refreshIntervalMinutes(config)).toBe(30);
});

test('refreshIntervalMinutes defaults to 10 when no conflict calendars', () => {
	const config = {
		calendars: [{ id: 'a' }],
		event_types: [{}]
	} as unknown as WhenConfiguration;
	expect(refreshIntervalMinutes(config)).toBe(10);
});

test('scheduler runs on start, reschedules each interval, and stops', async () => {
	vi.useFakeTimers();
	let calls = 0;
	const scheduler = createRefreshScheduler(async () => {
		calls++;
	}, 1000);

	scheduler.start();
	expect(calls).toBe(1);

	await vi.advanceTimersByTimeAsync(1000);
	expect(calls).toBe(2);

	await vi.advanceTimersByTimeAsync(1000);
	expect(calls).toBe(3);

	scheduler.stop();
	await vi.advanceTimersByTimeAsync(5000);
	expect(calls).toBe(3);
});
