import { afterEach, expect, test, vi } from 'vitest';
import { createRefreshScheduler } from './scheduler.js';

afterEach(() => vi.useRealTimers());

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
