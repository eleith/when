import { watch, type FSWatcher } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { loadConfigFile } from './load.js';
import { resolveConfigPath } from './paths.js';
import type { WhenConfiguration } from './schema.js';

let current: WhenConfiguration | null = null;
let currentPath: string | null = null;
let watcher: FSWatcher | null = null;
let watchedPath: string | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;

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

// fs.watch fires several events per save, so debounce to a single reload.
export function watchConfig(onReload: (result: ReloadResult) => void): () => void {
	const path = currentPath ?? resolveConfigPath();
	if (watcher && watchedPath === path) return stopWatch;
	stopWatch();
	watchedPath = path;
	watcher = watch(path, () => {
		if (pending) clearTimeout(pending);
		pending = setTimeout(() => {
			pending = null;
			void reloadConfig().then(onReload);
		}, 100);
	});
	return stopWatch;
}

function stopWatch(): void {
	if (pending) clearTimeout(pending);
	pending = null;
	watcher?.close();
	watcher = null;
	watchedPath = null;
}

export function configChanged(
	a: WhenConfiguration,
	b: WhenConfiguration,
	keys: (keyof WhenConfiguration)[]
): boolean {
	return keys.some((key) => !isDeepStrictEqual(a[key], b[key]));
}
