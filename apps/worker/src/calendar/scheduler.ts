import type { WhenConfiguration } from '@when/config';
import { conflictCalendarIds } from './refresh.js';

const DEFAULT_REFRESH_INTERVAL_MINUTES = 10;

export function refreshIntervalMinutes(config: WhenConfiguration): number {
	const ids = new Set(conflictCalendarIds(config));
	let min = Infinity;
	for (const cal of config.calendars) {
		if (!ids.has(cal.id)) continue;
		min = Math.min(min, cal.sync?.refresh_interval ?? DEFAULT_REFRESH_INTERVAL_MINUTES);
	}
	return Number.isFinite(min) ? min : DEFAULT_REFRESH_INTERVAL_MINUTES;
}

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
