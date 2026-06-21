import { type Kysely } from 'kysely';
import {
	appendJobLogSql,
	parseActionLog,
	type Database,
	type JobKind,
	type JobState
} from '@when/db';

// Append a system job entry (`email`/`calendar`) to an appointment's action log.
export async function appendJobLog(
	db: Kysely<Database>,
	appointmentId: string,
	kind: JobKind,
	state: JobState,
	at: string
): Promise<void> {
	await db
		.updateTable('appointments')
		.set({ action_log: appendJobLogSql({ kind, at, state, appointment_id: appointmentId }) })
		.where('id', '=', appointmentId)
		.execute();
}

// Whether the log already holds an open (not yet `done`) calendar `queued` entry
// for this row, so a reconcile retry doesn't append a second one. Scoped to
// `appointment_id` because the log is inherited across a reschedule chain.
export function hasOpenCalendarJob(actionLog: string | null, appointmentId: string): boolean {
	const last = parseActionLog(actionLog)
		.filter((e) => e.action === 'calendar' && e.payload?.metadata?.appointment_id === appointmentId)
		.at(-1);
	return last?.payload?.metadata?.state === 'queued';
}
