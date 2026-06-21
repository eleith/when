import { type Kysely } from 'kysely';
import {
	appendJobLogSql,
	parseActionLog,
	type Database,
	type JobKind,
	type JobState
} from '@when/db';

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

// Scoped to appointment_id: the log is inherited across a reschedule chain.
export function openCalendarQueuedAt(
	actionLog: string | null,
	appointmentId: string
): string | null {
	const last = parseActionLog(actionLog)
		.filter((e) => e.action === 'calendar' && e.payload?.metadata?.appointment_id === appointmentId)
		.at(-1);
	return last?.payload?.metadata?.state === 'queued' ? last.at : null;
}

export function hasOpenCalendarJob(actionLog: string | null, appointmentId: string): boolean {
	return openCalendarQueuedAt(actionLog, appointmentId) !== null;
}
