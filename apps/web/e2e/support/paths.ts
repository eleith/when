import { join } from 'node:path';

export function workerDirectory(): string {
	const run = process.env.WHEN_E2E_RUN_DIR;
	// Playwright sets this official variable before importing specs in each worker.
	// Unlike parallelIndex, workerIndex changes when a failed worker is replaced.
	const index = process.env.TEST_WORKER_INDEX;
	if (!run || index === undefined)
		throw new Error('E2E paths require the Playwright worker fixture');
	return join(run, `worker-${index}`);
}
