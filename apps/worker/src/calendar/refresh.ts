import { Temporal } from '@js-temporal/polyfill';
import type { Calendar, WhenConfiguration } from '@when/config';
import type { ExpandWindow } from '@when/calendar';
import { fetchBusyIntervals } from '@when/calendar';
import {
	listCalendarSyncStatus,
	listOwnEventIds,
	recordRefreshResult,
	replaceCalendarBusy
} from '@when/db';
import type { WorkerContext } from '../services/context.js';
import { calendarRefreshTotal } from '../services/metrics.js';
import { flagConflicts } from './conflicts.js';
import { DEFAULT_REFRESH_INTERVAL_MINUTES } from './intervals.js';

const DEFAULT_MAX_LOOKAHEAD_DAYS = 60;

export interface RefreshOptions {
	now?: Temporal.Instant;
}

export function conflictCalendarIds(config: WhenConfiguration): string[] {
	const ids = new Set<string>();
	for (const et of config.event_types) {
		for (const id of et.conflict_calendars ?? []) ids.add(id);
	}
	return [...ids];
}

export function refreshWindow(
	config: WhenConfiguration,
	calendarId: string,
	now: Temporal.Instant
): ExpandWindow {
	let days = 0;
	for (const et of config.event_types) {
		if (!(et.conflict_calendars ?? []).includes(calendarId)) continue;
		const lookahead =
			et.maximum_lookahead ?? config.availability.maximum_lookahead ?? DEFAULT_MAX_LOOKAHEAD_DAYS;
		days = Math.max(days, lookahead);
	}
	if (days === 0) days = DEFAULT_MAX_LOOKAHEAD_DAYS;
	return { start: now, end: now.add({ hours: 24 * days }) };
}

export async function refreshCalendar(
	ctx: WorkerContext,
	cal: Calendar,
	window: ExpandWindow,
	opts: RefreshOptions = {}
): Promise<void> {
	const at = (opts.now ?? window.start).toString();
	try {
		const excludeUids = new Set(await listOwnEventIds(ctx.db, cal.id));
		const intervals = await fetchBusyIntervals(cal, window, {
			excludeUids,
			config: ctx.config
		});
		await replaceCalendarBusy(
			ctx.db,
			cal.id,
			intervals.map((i) => ({ start: i.start.toString(), end: i.end.toString() }))
		);
		await recordRefreshResult(ctx.db, cal.id, { at });
		calendarRefreshTotal.inc({
			calendar_id: cal.id,
			provider_type: cal.type,
			status: 'success'
		});
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		ctx.logger.error(
			{
				calendarId: cal.id,
				error
			},
			'calendar refresh failed; keeping stale busy times'
		);
		await recordRefreshResult(ctx.db, cal.id, { at, error });
		calendarRefreshTotal.inc({
			calendar_id: cal.id,
			provider_type: cal.type,
			status: 'failure'
		});
	}
}

export async function refreshCalendars(
	ctx: WorkerContext,
	opts: RefreshOptions = {}
): Promise<void> {
	const now = opts.now ?? Temporal.Now.instant();
	const statuses = await listCalendarSyncStatus(ctx.db);
	const lastSuccess = new Map(statuses.map((s) => [s.calendar_id, s.last_successful_refresh_at]));
	for (const id of conflictCalendarIds(ctx.config)) {
		const cal = ctx.config.calendars.find((c) => c.id === id);
		if (!cal) {
			ctx.logger.warn({ calendarId: id }, 'conflict_calendar id not found in calendars; skipping');
			continue;
		}
		// Each calendar refreshes on its own interval; a never-synced or failing one
		// (no recent success) is always due, so failures retry every tick.
		if (!isDue(lastSuccess.get(id) ?? null, cal, now)) continue;
		await refreshCalendar(ctx, cal, refreshWindow(ctx.config, id, now), { ...opts, now });
	}
}

function isDue(lastSuccess: string | null, cal: Calendar, now: Temporal.Instant): boolean {
	if (!lastSuccess) return true;
	const interval = cal.sync?.refresh_interval ?? DEFAULT_REFRESH_INTERVAL_MINUTES;
	const nextDue = Temporal.Instant.from(lastSuccess).add({ minutes: interval });
	return Temporal.Instant.compare(now, nextDue) >= 0;
}

export async function refreshCycle(ctx: WorkerContext, opts: RefreshOptions = {}): Promise<void> {
	const now = opts.now ?? Temporal.Now.instant();
	await refreshCalendars(ctx, { ...opts, now });
	await flagConflicts(ctx, { now });
}
