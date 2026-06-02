import type { WhenConfiguration } from '@when/config';
import type { openDb } from '@when/db';
import type { Logger } from './logger.js';

/** Shared, process-wide handles workflow implementations reach for at run time. */
export interface WorkerContext {
	config: WhenConfiguration;
	logger: Logger;
	db: ReturnType<typeof openDb>;
}

let context: WorkerContext | null = null;

/** Set once at boot (in `main`), before any workflow runs. */
export function setWorkerContext(ctx: WorkerContext): void {
	context = ctx;
}

/** The boot-time context. Throws if accessed before `main` has set it. */
export function getWorkerContext(): WorkerContext {
	if (!context) {
		throw new Error('worker context not initialized — main() must set it at boot');
	}
	return context;
}
