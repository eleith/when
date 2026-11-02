import { mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { startConfigReloading } from './monitor.js';

test('observes successive atomic saves even when modification time is preserved', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'when-monitor-'));
	const path = join(directory, 'when.yaml');
	let accepted = 'initial';
	const errors: unknown[] = [];
	await writeFile(path, accepted);
	const original = await stat(path);
	const monitor = startConfigReloading({
		path,
		initial: accepted,
		load: (path) => readFile(path, 'utf8'),
		onChange(next) {
			accepted = next;
			return true;
		},
		onError: (error) => errors.push(error)
	});
	try {
		await monitor.ready;
		for (const next of ['first save', 'second save']) {
			const temporary = join(directory, 'next.yaml');
			await writeFile(temporary, next);
			await utimes(temporary, original.atime, original.mtime);
			await rename(temporary, path);
			await vi.waitFor(() => expect(accepted).toBe(next), { timeout: 4000, interval: 50 });
		}
		expect(errors).toEqual([]);
	} finally {
		monitor.stop();
		await rm(directory, { recursive: true, force: true });
	}
});
