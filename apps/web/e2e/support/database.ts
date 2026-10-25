import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { findAppointment, openDb, type Appointment } from '@when/db';

import { workerDirectory } from './paths.ts';

// Specs are also imported for collection, before global setup. Paths are only used
// inside workers, where Playwright provides TEST_WORKER_INDEX and inherits the run dir.
const dataDirectory =
	process.env.TEST_WORKER_INDEX === undefined ? '' : join(workerDirectory(), 'data');
export const APP_DB_PATH = dataDirectory ? join(dataDirectory, 'when.sqlite') : '';
const QUEUE_DB_PATH = dataDirectory ? join(dataDirectory, 'openworkflow.sqlite') : '';

export function resetDatabases(): void {
	workerDirectory(); // Fail rather than silently falling back to a developer database.
	for (const [path, tables] of [
		[APP_DB_PATH, ['appointments', 'external_calendar_busy', 'service_status']],
		[QUEUE_DB_PATH, ['workflow_signals', 'workflow_schedules', 'step_attempts', 'workflow_runs']]
	] as const) {
		const db = new DatabaseSync(path);
		try {
			// Keep migration bookkeeping and schemas; no background worker runs in E2E.
			db.exec('PRAGMA foreign_keys = ON; BEGIN; PRAGMA defer_foreign_keys = ON;');
			for (const table of tables) db.exec(`DELETE FROM ${table}`);
			db.exec('COMMIT');
		} finally {
			db.close();
		}
	}
}

/**
 * The stored row behind an appointment page. The pages render a lossy view of it —
 * a status heading says nothing about the audit trail or the guest's own answers —
 * so anything a write is supposed to persist is asserted here instead.
 */
export async function readAppointment(id: string): Promise<Appointment> {
	const db = openDb(APP_DB_PATH);

	try {
		const row = await findAppointment(db, id);
		if (!row) throw new Error(`no appointment "${id}" in the fixture database`);
		return row;
	} finally {
		await db.destroy();
	}
}

/**
 * Runs enqueued under an idempotency key. No worker runs during E2E, so a queued run
 * is as far as the guest's email and the calendar push can be observed — but it is the
 * difference between accepting an appointment and merely recording that we did.
 */
export function readQueuedWorkflows(idempotencyKey: string): { workflow_name: string }[] {
	const db = new DatabaseSync(QUEUE_DB_PATH);

	try {
		return db
			.prepare('SELECT workflow_name FROM workflow_runs WHERE idempotency_key = ?')
			.all(idempotencyKey) as unknown as { workflow_name: string }[];
	} finally {
		db.close();
	}
}
