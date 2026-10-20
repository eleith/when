import { createServer } from 'node:http';
import { afterEach, expect, test, vi } from 'vitest';
import { createShutdown } from './lifecycle.js';

afterEach(() => vi.restoreAllMocks());

test('repeated shutdown requests share a promise and close resources in order', async () => {
	const events: string[] = [];
	const activePass = Promise.withResolvers<void>();
	const server = createServer();
	vi.spyOn(server, 'listening', 'get').mockReturnValue(true);
	let finishHttp = () => {};
	vi.spyOn(server, 'close').mockImplementation((callback) => {
		events.push('http:stop');
		finishHttp = () => {
			events.push('http:closed');
			callback?.();
		};
		return server;
	});
	const stopWorker = vi.fn(async () => {
		events.push('worker:stop');
		await activePass.promise;
		events.push('worker:stopped');
	});
	const shutdown = createShutdown({
		server,
		worker: { stop: stopWorker },
		stopWatch: () => events.push('watch:stop'),
		closeQueue: async () => {
			events.push('queue:close');
		},
		closeDatabase: async () => {
			events.push('database:close');
		}
	});

	const first = shutdown();
	expect(shutdown()).toBe(first);
	expect(events).toEqual(['watch:stop', 'http:stop', 'worker:stop']);
	activePass.resolve();
	await vi.waitFor(() => expect(events).toContain('worker:stopped'));
	expect(events).not.toContain('queue:close');
	finishHttp();
	await first;
	expect(events).toEqual([
		'watch:stop',
		'http:stop',
		'worker:stop',
		'worker:stopped',
		'http:closed',
		'queue:close',
		'database:close'
	]);
	expect(shutdown()).toBe(first);
	expect(stopWorker).toHaveBeenCalledOnce();
});

test('partial startup closes the queue and database without a worker or server', async () => {
	const closeQueue = vi.fn(async () => {});
	const closeDatabase = vi.fn(async () => {});
	const shutdown = createShutdown({ closeQueue, closeDatabase });
	await shutdown();
	await shutdown();
	expect(closeQueue).toHaveBeenCalledOnce();
	expect(closeDatabase).toHaveBeenCalledOnce();
	expect(closeQueue.mock.invocationCallOrder[0]).toBeLessThan(
		closeDatabase.mock.invocationCallOrder[0]
	);
});

test('a failed worker stop leaves its database connections open', async () => {
	const error = new Error('worker stop failed');
	const closeQueue = vi.fn(async () => {});
	const closeDatabase = vi.fn(async () => {});
	const stop = vi.fn().mockRejectedValue(error);
	const shutdown = createShutdown({ worker: { stop }, closeQueue, closeDatabase });
	const pending = shutdown();
	await expect(pending).rejects.toBe(error);
	expect(shutdown()).toBe(pending);
	expect(stop).toHaveBeenCalledOnce();
	expect(closeQueue).not.toHaveBeenCalled();
	expect(closeDatabase).not.toHaveBeenCalled();
});

test('a queue close failure still closes the application database', async () => {
	const error = new Error('queue close failed');
	const closeDatabase = vi.fn(async () => {});
	const shutdown = createShutdown({
		closeQueue: vi.fn().mockRejectedValue(error),
		closeDatabase
	});
	await expect(shutdown()).rejects.toBe(error);
	expect(closeDatabase).toHaveBeenCalledOnce();
});

test.each(['callback', 'throw'])(
	'an HTTP close %s error is reported after database cleanup',
	async (mode) => {
		const error = new Error('HTTP close failed');
		const server = createServer();
		vi.spyOn(server, 'listening', 'get').mockReturnValue(true);
		vi.spyOn(server, 'close').mockImplementation((callback) => {
			if (mode === 'throw') throw error;
			callback?.(error);
			return server;
		});
		const closeQueue = vi.fn(async () => {});
		const closeDatabase = vi.fn(async () => {});
		const shutdown = createShutdown({ server, closeQueue, closeDatabase });
		await expect(shutdown()).rejects.toBe(error);
		expect(closeQueue).toHaveBeenCalledOnce();
		expect(closeDatabase).toHaveBeenCalledOnce();
	}
);

test('a database close failure is propagated and not retried by another signal', async () => {
	const error = new Error('database close failed');
	const closeDatabase = vi.fn().mockRejectedValue(error);
	const shutdown = createShutdown({ closeQueue: async () => {}, closeDatabase });
	await expect(shutdown()).rejects.toBe(error);
	await expect(shutdown()).rejects.toBe(error);
	expect(closeDatabase).toHaveBeenCalledOnce();
});
