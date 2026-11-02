import type { Stats } from 'node:fs';
import { beforeEach, expect, test, vi } from 'vitest';
import { startConfigReloading } from './monitor.js';

type Listener = (current: Stats, previous: Stats) => Promise<void>;
const filesystem = vi.hoisted(() => ({
	watchFile: vi.fn<(path: string, options: object, listener: Listener) => void>(),
	unwatchFile: vi.fn()
}));
vi.mock('node:fs', () => filesystem);

const path = '/synthetic/when.yaml';

function options() {
	return {
		path,
		initial: 0,
		load: vi.fn<(path: string) => Promise<number>>().mockResolvedValue(1),
		onChange: vi.fn<(next: number, previous: number) => boolean>().mockReturnValue(true),
		onError: vi.fn<(error: unknown) => void>()
	};
}

function listener(index = 0): Listener {
	return filesystem.watchFile.mock.calls[index]![2];
}

function change(index = 0): Promise<void> {
	const previous = { ino: 10, mtimeMs: 100, ctimeMs: 100, size: 50 } as Stats;
	const current = { ...previous, ctimeMs: 101 };
	return listener(index)(current, previous);
}

beforeEach(() => vi.resetAllMocks());

test('returns cleanup before reading and waits for initial reconciliation', async () => {
	const input = options();
	const read = Promise.withResolvers<number>();
	input.load.mockReturnValueOnce(read.promise);
	const monitor = startConfigReloading(input);
	const ready = vi.fn();
	void monitor.ready.then(ready);
	expect(input.load).not.toHaveBeenCalled();
	await Promise.resolve();
	expect(input.load).toHaveBeenCalledWith(path);
	expect(ready).not.toHaveBeenCalled();
	read.resolve(1);
	await monitor.ready;
	expect(input.onChange).toHaveBeenCalledExactlyOnceWith(1, 0);
	monitor.stop();
});

test('can stop startup reconciliation before its scheduled read begins', async () => {
	const input = options();
	const monitor = startConfigReloading(input);
	monitor.stop();
	await monitor.ready;
	expect(input.load).not.toHaveBeenCalled();
	expect(input.onChange).not.toHaveBeenCalled();
	expect(input.onError).not.toHaveBeenCalled();
});

test('rejected edits and failed reads retain the accepted baseline until recovery', async () => {
	const input = options();
	const monitor = startConfigReloading(input);
	await monitor.ready;

	input.load.mockResolvedValueOnce(2);
	input.onChange.mockReturnValueOnce(false);
	await change();
	const failure = new Error('configuration unreadable');
	input.load.mockRejectedValueOnce(failure);
	await change();
	input.load.mockResolvedValueOnce(3).mockResolvedValueOnce(4);
	await change();
	await change();

	expect(input.onChange.mock.calls).toEqual([
		[1, 0],
		[2, 1],
		[3, 1],
		[4, 3]
	]);
	expect(input.onError).toHaveBeenCalledExactlyOnceWith(failure);
	monitor.stop();
});

test('serializes a slow read and coalesces edits into one follow-up', async () => {
	const input = options();
	const first = Promise.withResolvers<number>();
	const second = Promise.withResolvers<number>();
	const readingAgain = Promise.withResolvers<void>();
	input.load.mockReturnValueOnce(first.promise).mockImplementationOnce(() => {
		readingAgain.resolve();
		return second.promise;
	});
	const monitor = startConfigReloading(input);
	await Promise.resolve();
	for (let index = 0; index < 5; index++) void change();
	expect(input.load).toHaveBeenCalledOnce();
	first.resolve(1);
	await readingAgain.promise;
	expect(input.onChange).toHaveBeenCalledExactlyOnceWith(1, 0);
	second.resolve(2);
	await monitor.ready;
	expect(input.load).toHaveBeenCalledTimes(2);
	expect(input.onChange).toHaveBeenLastCalledWith(2, 1);
	monitor.stop();
});

test('stopping drops late and queued work without stopping another monitor on the path', async () => {
	const first = options();
	const second = options();
	const firstMonitor = startConfigReloading(first);
	const secondMonitor = startConfigReloading(second);
	await Promise.all([firstMonitor.ready, secondMonitor.ready]);

	const read = Promise.withResolvers<number>();
	first.load.mockReturnValueOnce(read.promise);
	const pending = change(0);
	await Promise.resolve();
	void change(0);
	firstMonitor.stop();
	firstMonitor.stop();
	read.resolve(2);
	await pending;
	await change(0);
	await change(1);

	expect(first.load).toHaveBeenCalledTimes(2);
	expect(first.onChange).toHaveBeenCalledOnce();
	expect(first.onError).not.toHaveBeenCalled();
	expect(second.load).toHaveBeenCalledTimes(2);
	expect(filesystem.unwatchFile).toHaveBeenCalledExactlyOnceWith(path, listener(0));
	secondMonitor.stop();
});
