import { watchFile, unwatchFile, type Stats } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { loadConfigFile } from './load.js';
import { resolveConfigPath } from './paths.js';
import type { WhenConfiguration } from './schema.js';

let current: WhenConfiguration | null = null;
let currentPath: string | null = null;
let watchedPath: string | null = null;

export async function loadConfig(path: string = resolveConfigPath()): Promise<WhenConfiguration> {
	if (current && currentPath === path) return current;
	current = await loadConfigFile(path);
	currentPath = path;
	return current;
}

export type ReloadResult = { ok: true; config: WhenConfiguration } | { ok: false; error: unknown };

// On failure the cache is kept, so a broken edit never replaces a good config.
export async function reloadConfig(): Promise<ReloadResult> {
	const path = currentPath ?? resolveConfigPath();
	try {
		const config = await loadConfigFile(path);
		current = config;
		currentPath = path;
		return { ok: true, config };
	} catch (error) {
		return { ok: false, error };
	}
}

// Polls (stat) rather than inotify: editors save when.yaml via atomic rename,
// which swaps the inode so a file-level fs.watch misses every edit after the
// first. Polling watches the path, not the inode, so it survives the swap.
export function watchConfig(onReload: (result: ReloadResult) => void): () => void {
	const path = currentPath ?? resolveConfigPath();
	if (watchedPath === path) return stopWatch;
	stopWatch();
	watchedPath = path;
	watchFile(path, { interval: 1000 }, (curr: Stats, prev: Stats) => {
		if (curr.mtimeMs === prev.mtimeMs) return;
		void reloadConfig().then(onReload);
	});
	return stopWatch;
}

function stopWatch(): void {
	if (watchedPath) unwatchFile(watchedPath);
	watchedPath = null;
}

export function configChanged(
	a: WhenConfiguration,
	b: WhenConfiguration,
	keys: (keyof WhenConfiguration)[]
): boolean {
	return keys.some((key) => !isDeepStrictEqual(a[key], b[key]));
}
