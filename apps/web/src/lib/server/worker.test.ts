import { expect, test, vi } from 'vitest';
import { workerReachable } from './worker';

const url = 'http://when-worker:9000';

test('a healthy worker answers /healthz', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
	expect(await workerReachable(url)).toBe(true);
});

test('a stopped worker is reported without throwing', async () => {
	vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
	expect(await workerReachable(url)).toBe(false);
});

test('a worker answering with an error status is not healthy', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
	expect(await workerReachable(url)).toBe(false);
});
