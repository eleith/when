export interface RefreshScheduler {
	start(): void;
	stop(): void;
}

export function createRefreshScheduler(
	run: () => Promise<void>,
	intervalMs: number
): RefreshScheduler {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	async function tick(): Promise<void> {
		try {
			await run();
		} finally {
			if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
		}
	}

	return {
		start() {
			stopped = false;
			void tick();
		},
		stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			timer = null;
		}
	};
}
