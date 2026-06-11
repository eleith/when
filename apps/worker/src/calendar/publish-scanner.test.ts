import { afterEach, expect, test, vi } from 'vitest';
import { createPublishScanner } from './publish-scanner.js';

afterEach(() => vi.useRealTimers());

const flush = () => new Promise((r) => setTimeout(r, 0));

test('runs on request and reschedules on the floor', async () => {
	vi.useFakeTimers();
	let calls = 0;
	const scanner = createPublishScanner(async () => {
		calls++;
	}, 1000);

	scanner.requestScan();
	await vi.advanceTimersByTimeAsync(0);
	expect(calls).toBe(1);

	await vi.advanceTimersByTimeAsync(1000);
	expect(calls).toBe(2);

	scanner.stop();
	await vi.advanceTimersByTimeAsync(5000);
	expect(calls).toBe(2);
});

test('coalesces requests that arrive during a scan into one rerun', async () => {
	let calls = 0;
	let release: () => void = () => {};
	const run = () => {
		calls++;
		return new Promise<void>((r) => {
			release = r;
		});
	};
	const scanner = createPublishScanner(run, 10_000);

	scanner.requestScan();
	await flush();
	expect(calls).toBe(1);

	scanner.requestScan();
	scanner.requestScan();
	expect(calls).toBe(1);

	release();
	await flush();
	expect(calls).toBe(2);

	release();
	await flush();
	expect(calls).toBe(2);

	scanner.stop();
});

test('stop prevents new requests from running', async () => {
	let calls = 0;
	const scanner = createPublishScanner(async () => {
		calls++;
	}, 10_000);
	scanner.stop();
	scanner.requestScan();
	await flush();
	expect(calls).toBe(0);
});
