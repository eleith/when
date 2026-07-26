import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { findAppointment, openDb, type Appointment } from '@when/db';

// The fixture config makes `e2e/fixture/` the deployment root, so both databases
// land under its `data/` at the paths `database.app` and `database.queue` default to.
export const APP_DB_PATH = fileURLToPath(new URL('../fixture/data/when.sqlite', import.meta.url));
const QUEUE_DB_PATH = fileURLToPath(
	new URL('../fixture/data/openworkflow.sqlite', import.meta.url)
);

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
