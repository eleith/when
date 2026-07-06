import { getBusyIntervals, listUpcomingActiveAppointments, setPossibleConflicts } from '@when/db';
import type { WorkerContext } from '../services/context.js';

export interface FlagConflictsOptions {
	now?: Temporal.Instant;
}

export async function flagConflicts(
	ctx: WorkerContext,
	opts: FlagConflictsOptions = {}
): Promise<void> {
	const now = (opts.now ?? Temporal.Now.instant()).toString();
	const appointments = await listUpcomingActiveAppointments(ctx.db, now);

	const flagged: string[] = [];
	const cleared: string[] = [];
	for (const appt of appointments) {
		const eventType = ctx.config.event_types.find((e) => e.id === appt.event_type_id);
		const conflictCalendars = eventType?.conflict_calendars ?? [];
		const busy = await getBusyIntervals(ctx.db, conflictCalendars, {
			start: appt.start_time,
			end: appt.end_time
		});
		(busy.length > 0 ? flagged : cleared).push(appt.id);
	}

	await setPossibleConflicts(ctx.db, flagged, cleared);
}
