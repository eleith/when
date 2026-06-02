import { OpenWorkflow } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import type { DatabaseSync } from 'node:sqlite';

let instance: OpenWorkflow | null = null;

export interface InitOpenWorkflowOptions {
	/** Path to the openworkflow `node:sqlite` queue DB (or `:memory:`). */
	dbPath: string;
}

/**
 * Initialize the process-wide openworkflow client over a `node:sqlite` backend.
 * Idempotent: the first call wins; later calls return the same instance. The
 * worker calls this at boot; the web producer keeps its own client (it lives in
 * a separate process), so the singleton is per-process either way.
 */
export function initOpenWorkflow({ dbPath }: InitOpenWorkflowOptions): OpenWorkflow {
	if (!instance) {
		instance = new OpenWorkflow({ backend: BackendSqlite.connect(dbPath) });
	}
	return instance;
}

/** The initialized client. Throws if `initOpenWorkflow` hasn't been called. */
export function getOpenWorkflow(): OpenWorkflow {
	if (!instance) {
		throw new Error(
			'openworkflow client has not been initialized; call initOpenWorkflow({ dbPath }) first'
		);
	}
	return instance;
}

/** A row from openworkflow's `workflow_runs` table (the columns web cares about). */
export interface WorkflowRunRow {
	id: string;
	workflow_name: string;
	status: string;
	error: string | null;
	input: string | null;
	output: string | null;
	finished_at: string | null;
	created_at: string;
}

/** A flattened step attempt, for surfacing run progress in the UI. */
export interface StepAttemptRow {
	phase: string;
	status: string;
	started_at: string | null;
	finished_at: string | null;
	message: string | null;
}

/**
 * Look up a single workflow run by id. Read-only over a raw `DatabaseSync`
 * handle to the queue DB, so consumers (web) can surface run status without
 * pulling in the openworkflow engine.
 */
export function getWorkflowRun(db: DatabaseSync, id: string): WorkflowRunRow | null {
	const row = db
		.prepare(
			`SELECT id, workflow_name, status, error, input, output, finished_at, created_at
			 FROM workflow_runs WHERE id = ? LIMIT 1`
		)
		.get(id);
	return row ? (row as unknown as WorkflowRunRow) : null;
}

/** List a run's step attempts in chronological order. */
export function getStepAttempts(db: DatabaseSync, workflowRunId: string): StepAttemptRow[] {
	const rows = db
		.prepare(
			`SELECT step_name AS phase, status, started_at, finished_at, error AS message
			 FROM step_attempts WHERE workflow_run_id = ? ORDER BY created_at ASC`
		)
		.all(workflowRunId);
	return rows as unknown as StepAttemptRow[];
}
