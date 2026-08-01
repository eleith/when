const HEALTH_TIMEOUT_MS = 3_000;

// An unclaimed run sits pending until the result poll times out, so a stopped worker is
// worth naming before waiting half a minute for it.
export async function workerReachable(workerUrl: string): Promise<boolean> {
	try {
		const res = await fetch(`${workerUrl.replace(/\/$/, '')}/healthz`, {
			signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
		});
		return res.ok;
	} catch {
		return false;
	}
}
