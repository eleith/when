import { findCalendar, type ResolvedCalendar, type WhenConfiguration } from '@when/config';
import type { ExpandWindow } from '@when/calendar';
import { busyCalendarsFor, connectProviders, fetchBusyIntervals } from '@when/calendar';
import {
	listOwnEventIds,
	listServiceStatus,
	recordServiceOutcome,
	replaceCalendarBusy,
	type ServiceOutcome
} from '@when/db';
import type { WorkerContext } from '../services/context.js';
import { calendarRefreshTotal } from '../services/metrics.js';
import { flagConflicts } from './conflicts.js';

const DEFAULT_MAX_LOOKAHEAD_DAYS = 60;

export interface RefreshOptions {
	now?: Temporal.Instant;
	via?: ServiceOutcome['via'];
}

export type RefreshResult = { ok: true; busyCount: number } | { ok: false; error: string };

export function busyCalendarIds(config: WhenConfiguration): string[] {
	const ids = new Set<string>();
	for (const meeting of config.meetings) {
		for (const name of busyCalendarsFor(meeting)) ids.add(name);
	}
	return [...ids];
}

export function refreshWindow(
	config: WhenConfiguration,
	calendarId: string,
	now: Temporal.Instant
): ExpandWindow {
	let days = 0;
	for (const meeting of config.meetings) {
		if (!busyCalendarsFor(meeting).includes(calendarId)) continue;
		const lookahead = meeting.booking_window_days;
		days = Math.max(days, lookahead);
	}
	if (days === 0) days = DEFAULT_MAX_LOOKAHEAD_DAYS;
	return { start: now, end: now.add({ hours: 24 * days }) };
}

export async function refreshCalendar(
	ctx: WorkerContext,
	cal: ResolvedCalendar,
	window: ExpandWindow,
	opts: RefreshOptions = {}
): Promise<RefreshResult> {
	const at = (opts.now ?? window.start).toString();
	const via = opts.via ?? 'refresh';
	try {
		const excludeUids = new Set(await listOwnEventIds(ctx.db, cal.calendar.name));
		const services = await connectProviders(ctx.config.providers, ctx.db);
		const intervals = await fetchBusyIntervals(cal, window, { excludeUids, services });
		await replaceCalendarBusy(
			ctx.db,
			cal.calendar.name,
			intervals.map((i) => ({ start: i.start.toString(), end: i.end.toString() }))
		);
		await recordRefreshOutcome(ctx, cal, { at, via });
		calendarRefreshTotal.inc({
			calendar_id: cal.calendar.name,
			provider_type: cal.provider.type,
			status: 'success'
		});
		return { ok: true, busyCount: intervals.length };
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		ctx.logger.error(
			{
				calendarId: cal.calendar.name,
				error
			},
			'calendar refresh failed; keeping stale busy times'
		);
		await recordRefreshOutcome(ctx, cal, { at, via, error });
		calendarRefreshTotal.inc({
			calendar_id: cal.calendar.name,
			provider_type: cal.provider.type,
			status: 'failure'
		});
		return { ok: false, error };
	}
}

// A provider backing no calendars has no other source of status.
async function recordRefreshOutcome(
	ctx: WorkerContext,
	cal: ResolvedCalendar,
	outcome: ServiceOutcome
): Promise<void> {
	await recordServiceOutcome(ctx.db, { kind: 'calendar', name: cal.calendar.name }, outcome);
	await recordServiceOutcome(ctx.db, { kind: 'provider', name: cal.provider.name }, outcome);
}

export async function refreshCalendars(
	ctx: WorkerContext,
	opts: RefreshOptions = {}
): Promise<void> {
	const now = opts.now ?? Temporal.Now.instant();
	const statuses = await listServiceStatus(ctx.db, 'calendar');
	const lastSuccess = new Map(statuses.map((s) => [s.name, s.last_ok_at]));
	for (const id of busyCalendarIds(ctx.config)) {
		const cal = findCalendar(ctx.config, id);
		if (!cal) {
			ctx.logger.warn({ calendarId: id }, 'busy calendar id not found in calendars; skipping');
			continue;
		}
		// Each calendar refreshes on its own interval; a never-synced or failing one
		// (no recent success) is always due, so failures retry every tick.
		if (!isDue(lastSuccess.get(id) ?? null, cal, now)) continue;
		await refreshCalendar(ctx, cal, refreshWindow(ctx.config, id, now), { ...opts, now });
	}
}

function isDue(lastSuccess: string | null, cal: ResolvedCalendar, now: Temporal.Instant): boolean {
	if (!lastSuccess) return true;
	const interval = cal.calendar.sync.refresh_every_minutes;
	const nextDue = Temporal.Instant.from(lastSuccess).add({ minutes: interval });
	return Temporal.Instant.compare(now, nextDue) >= 0;
}

export async function refreshCycle(ctx: WorkerContext, opts: RefreshOptions = {}): Promise<void> {
	const now = opts.now ?? Temporal.Now.instant();
	await refreshCalendars(ctx, { ...opts, now });
	await flagConflicts(ctx, { now });
}
