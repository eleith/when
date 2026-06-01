import { OpenWorkflow } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';

export interface QueueOptions {
	/**
	 * Apply openworkflow's own schema migrations on connect. Default true; the
	 * worker owns the queue schema, so the web producer connects with `false`.
	 */
	runMigrations?: boolean;
}

/** Connect a `node:sqlite` openworkflow backend at `path` (or `:memory:`). */
export function createBackend(path: string, opts: QueueOptions = {}): BackendSqlite {
	return BackendSqlite.connect(path, opts);
}

/** Build an `OpenWorkflow` client over a `node:sqlite` backend at `path`. */
export function createClient(path: string, opts: QueueOptions = {}): OpenWorkflow {
	return new OpenWorkflow({ backend: createBackend(path, opts) });
}
