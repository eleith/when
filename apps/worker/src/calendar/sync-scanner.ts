export interface CalendarSyncScanner {
	requestScan(): void;
	stop(): void;
}

// One scan at a time (overlap guard via `scanning`); a request that arrives
// mid-scan is remembered and runs once more after, so bursts collapse into a
// single extra pass. Each run reschedules a floor timer, so an idle worker still
// scans every `floorMs`.
export function createCalendarSyncScanner(
	run: () => Promise<void>,
	floorMs: number
): CalendarSyncScanner {
	let scanning = false;
	let rescanRequested = false;
	let floorTimer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	function requestScan(): void {
		if (stopped) return;
		if (scanning) {
			rescanRequested = true;
			return;
		}
		scanning = true;
		void loop();
	}

	async function loop(): Promise<void> {
		try {
			do {
				rescanRequested = false;
				await run();
			} while (rescanRequested && !stopped);
		} catch {
			// A scan threw; the floor timer below retries.
		} finally {
			scanning = false;
			if (!stopped) {
				if (floorTimer) clearTimeout(floorTimer);
				floorTimer = setTimeout(requestScan, floorMs);
			}
		}
	}

	return {
		requestScan,
		stop() {
			stopped = true;
			if (floorTimer) clearTimeout(floorTimer);
			floorTimer = null;
		}
	};
}
