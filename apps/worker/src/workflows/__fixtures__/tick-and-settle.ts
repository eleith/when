import type { Worker } from 'openworkflow';
import type { BackendSqlite } from 'openworkflow/sqlite';
import { expect } from 'vitest';

// One explicit pass only: never admit children or retry work implicitly.
export async function tickAndSettle({
	backend,
	worker
}: {
	backend: BackendSqlite;
	worker: Worker;
}) {
	try {
		const ticked = await worker.tick();
		// Avoid stop()'s 100ms polling for short passes. Child-wait parents remain
		// running without an owner; completed runs can still retain their owner.
		await expect
			.poll(
				async () => {
					let after: string | undefined;
					do {
						const page = await backend.listWorkflowRuns({ status: 'running', limit: 100, after });
						if (page.data.some((run) => run.workerId !== null)) return true;
						after = page.pagination.next ?? undefined;
					} while (after);
					return false;
				},
				{ interval: 1, timeout: 5000 }
			)
			.toBe(false);
		return ticked;
	} finally {
		// Persisted state is only a hint; stop is the definitive execution barrier,
		// including when ticking or polling fails.
		await worker.stop();
	}
}
