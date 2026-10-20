import { OpenWorkflow, type Logger } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import type { DatabaseSync } from 'node:sqlite';

let instance: OpenWorkflow | null = null;
let backend: BackendSqlite | null = null;
let closePromise: Promise<void> | null = null;

export interface InitOpenWorkflowOptions {
	dbPath: string;
	logger?: Logger;
}

export function initOpenWorkflow({ dbPath, logger }: InitOpenWorkflowOptions): OpenWorkflow {
	if (closePromise) throw new Error('openworkflow client has been closed');
	if (!instance) {
		backend = BackendSqlite.connect(dbPath);
		instance = new OpenWorkflow({ backend, logger });
	}
	return instance;
}

// Stop the worker before closing its database connection.
export function closeOpenWorkflow(): Promise<void> {
	if (!backend) return Promise.resolve();
	closePromise ??= backend.stop();
	return closePromise;
}

export function getOpenWorkflow(): OpenWorkflow {
	if (closePromise) throw new Error('openworkflow client has been closed');
	if (!instance) {
		throw new Error(
			'openworkflow client has not been initialized; call initOpenWorkflow({ dbPath }) first'
		);
	}
	return instance;
}

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

export interface StepAttemptRow {
	phase: string;
	status: string;
	started_at: string | null;
	finished_at: string | null;
	message: string | null;
}

export function getWorkflowRun(db: DatabaseSync, id: string): WorkflowRunRow | null {
	const row = db
		.prepare(
			`SELECT id, workflow_name, status, error, input, output, finished_at, created_at
			 FROM workflow_runs WHERE id = ? LIMIT 1`
		)
		.get(id);
	return row ? (row as unknown as WorkflowRunRow) : null;
}

export function getStepAttempts(db: DatabaseSync, workflowRunId: string): StepAttemptRow[] {
	const rows = db
		.prepare(
			`SELECT step_name AS phase, status, started_at, finished_at, error AS message
			 FROM step_attempts WHERE workflow_run_id = ? ORDER BY created_at ASC`
		)
		.all(workflowRunId);
	return rows as unknown as StepAttemptRow[];
}
