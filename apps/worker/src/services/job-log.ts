import { type Kysely } from 'kysely';
import {
	appendJobLogSql,
	parseActionLog,
	type Appointment,
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

// The `at` of an unclosed calendar `failed` (no later `done`) for this row, or
// null. Scoped to appointment_id: the log is inherited across a reschedule chain.
// This timestamp is the log's "failing since".
export function openCalendarFailureAt(
	actionLog: string | null,
	appointmentId: string
): string | null {
	const last = parseActionLog(actionLog)
		.filter((e) => e.action === 'calendar' && e.payload?.metadata?.appointment_id === appointmentId)
		.at(-1);
	return last?.payload?.metadata?.state === 'failed' ? last.at : null;
}

export async function markCalendarFailing(
	db: Kysely<Database>,
	row: Pick<Appointment, 'id' | 'action_log'>,
	at: string
): Promise<void> {
	if (openCalendarFailureAt(row.action_log, row.id) !== null) return;
	await appendJobLog(db, row.id, 'calendar', 'failed', at);
}
