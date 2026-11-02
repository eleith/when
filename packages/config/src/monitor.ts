import { watchFile, unwatchFile, type Stats } from 'node:fs';

export interface ConfigReloadOptions<T> {
	path: string;
	initial: T;
	load: (path: string) => Promise<T>;
	/** Return true only after accepting the candidate. */
	onChange: (next: T, previous: T) => boolean;
	/** The caller owns safe diagnostics for raw failures. */
	onError: (error: unknown) => void;
}

export function startConfigReloading<T>({
	path,
	initial,
	load,
	onChange,
	onError
}: ConfigReloadOptions<T>): { stop: () => void; ready: Promise<void> } {
	let accepted = initial;
	let stopped = false;
	let pending = false;
	let activeReload: Promise<void> | undefined;

	async function runPendingReloads(): Promise<void> {
		try {
			while (!stopped && pending) {
				pending = false;
				try {
					const next = await load(path);
					if (stopped) return;
					if (onChange(next, accepted) && !stopped) accepted = next;
				} catch (error) {
					if (stopped) return;
					try {
						onError(error);
					} catch {
						// A failed diagnostic must not stop subsequent reloads.
					}
				}
			}
		} finally {
			activeReload = undefined;
		}
	}

	function scheduleReload(): Promise<void> {
		if (stopped) return Promise.resolve();
		pending = true;
		// Defer reads so callers own cleanup before reconciliation can apply a change.
		activeReload ??= Promise.resolve().then(runPendingReloads);
		return activeReload;
	}

	function listener(current: Stats, previous: Stats): Promise<void> {
		if (
			stopped ||
			(current.ino === previous.ino &&
				current.mtimeMs === previous.mtimeMs &&
				current.ctimeMs === previous.ctimeMs &&
				current.size === previous.size)
		) {
			return Promise.resolve();
		}
		return scheduleReload();
	}

	function stop(): void {
		if (stopped) return;
		stopped = true;
		pending = false;
		unwatchFile(path, listener);
	}

	// Poll the path so atomic saves and deletion/recreation remain observable.
	watchFile(path, { interval: 1000, persistent: false }, listener);
	return { stop, ready: scheduleReload() };
}
