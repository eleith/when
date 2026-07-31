import {
	getBusyIntervals,
	listUpcomingActiveAppointments,
	setPossibleConflicts,
	type UpcomingAppointment
} from '@when/db';
import { busyCalendarsFor } from '@when/calendar';
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

	const overlapping = overlappingAppointmentIds(appointments);
	const onBusyCalendar = await busyCalendarAppointmentIds(ctx, appointments);
	const conflicted = new Set([...overlapping, ...onBusyCalendar]);

	const flagged = appointments.filter((a) => conflicted.has(a.id)).map((a) => a.id);
	const cleared = appointments.filter((a) => !conflicted.has(a.id)).map((a) => a.id);
	await setPossibleConflicts(ctx.db, flagged, cleared);
}

// The busy mirror can't answer this: refresh strips our own published events from it.
function overlappingAppointmentIds(appointments: UpcomingAppointment[]): Set<string> {
	const sorted = appointments
		.map((a) => ({
			id: a.id,
			start: Temporal.Instant.from(a.start_time),
			end: Temporal.Instant.from(a.end_time)
		}))
		.sort((a, b) => Temporal.Instant.compare(a.start, b.start));

	const ids = new Set<string>();
	for (let i = 0; i < sorted.length; i++) {
		for (let j = i + 1; j < sorted.length; j++) {
			// Back-to-back is not a conflict.
			if (Temporal.Instant.compare(sorted[j].start, sorted[i].end) >= 0) break;
			ids.add(sorted[i].id);
			ids.add(sorted[j].id);
		}
	}
	return ids;
}

async function busyCalendarAppointmentIds(
	ctx: WorkerContext,
	appointments: UpcomingAppointment[]
): Promise<Set<string>> {
	const ids = new Set<string>();
	for (const appt of appointments) {
		const meeting = ctx.config.meetings.find((e) => e.name === appt.event_type_id);
		if (!meeting) continue;
		const busy = await getBusyIntervals(ctx.db, busyCalendarsFor(meeting), {
			start: appt.start_time,
			end: appt.end_time
		});
		if (busy.length > 0) ids.add(appt.id);
	}
	return ids;
}
