import { findCalendar, type ResolvedCalendar } from '@when/config';
import { listServiceStatus, lastCalendarRefreshAt } from '@when/db';
import type { WorkerContext } from '../services/context.js';
import { refreshCalendar } from '../services/calendar.js';
import { busyCalendarIds, refreshWindow, type RefreshOptions } from './refresh-calendar.js';
import { flagConflicts } from './conflicts.js';

export async function refreshCalendars(
	ctx: WorkerContext,
	opts: RefreshOptions = {}
): Promise<void> {
	const now = opts.now ?? Temporal.Now.instant();
	const statuses = await listServiceStatus(ctx.db, 'calendar');
	const statusesByName = new Map(statuses.map((s) => [s.name, s]));
	for (const id of busyCalendarIds(ctx.config)) {
		const cal = findCalendar(ctx.config, id);
		if (!cal) {
			ctx.logger.warn({ calendarId: id }, 'busy calendar id not found in calendars; skipping');
			continue;
		}
		const lastRefresh = lastCalendarRefreshAt(statusesByName.get(id));
		if (!isDue(lastRefresh, cal, now)) continue;
		await refreshCalendar(ctx, cal, refreshWindow(ctx.config, id, now), { ...opts, now });
	}
}

function isDue(lastRefresh: string | null, cal: ResolvedCalendar, now: Temporal.Instant): boolean {
	if (!lastRefresh) return true;
	const interval = cal.calendar.sync.refresh_every_minutes;
	const nextDue = Temporal.Instant.from(lastRefresh).add({ minutes: interval });
	return Temporal.Instant.compare(now, nextDue) >= 0;
}

export async function refreshCycle(ctx: WorkerContext, opts: RefreshOptions = {}): Promise<void> {
	const now = opts.now ?? Temporal.Now.instant();
	await refreshCalendars(ctx, { ...opts, now });
	await flagConflicts(ctx, { now });
}
