import { type ResolvedCalendar, type WhenConfiguration } from '@when/config';
import type { BusyWindow, Interval } from '@when/calendar';
import { busyCalendarsFor } from '@when/calendar';
import { fetchBusyIntervals } from '../services/calendar-provider.js';
import {
	listOwnEventIds,
	recordServiceOutcome,
	replaceCalendarBusy,
	type ServiceOutcome
} from '@when/db';
import type { WorkerContext } from '../services/context.js';

const DEFAULT_MAX_LOOKAHEAD_DAYS = 60;

export interface RefreshOptions {
	now?: Temporal.Instant;
	via?: ServiceOutcome['via'];
}

export type RefreshResult = { ok: true; busyCount: number } | { ok: false; error: string };

export function busyCalendarIds(config: WhenConfiguration): string[] {
	const ids = new Set<string>();
	for (const meeting of Object.values(config.meetings)) {
		for (const name of busyCalendarsFor(meeting)) ids.add(name);
	}
	return [...ids];
}

export function refreshWindow(
	config: WhenConfiguration,
	calendarId: string,
	now: Temporal.Instant
): BusyWindow {
	let days = 0;
	for (const meeting of Object.values(config.meetings)) {
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
	window: BusyWindow,
	opts: RefreshOptions = {}
): Promise<RefreshResult> {
	const at = (opts.now ?? window.start).toString();
	const via = opts.via ?? 'refresh';
	const ownEventIds = await listOwnEventIds(ctx.db, cal.name);
	const excludeUids = new Set(ownEventIds);
	let intervals: Interval[];
	try {
		intervals = await fetchBusyIntervals(cal, window, { excludeUids });
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		ctx.logger.error(
			{
				calendarId: cal.name,
				error
			},
			'calendar refresh failed; keeping stale busy times'
		);
		await recordRefreshOutcome(ctx, cal, { at, via, error });

		return { ok: false, error };
	}
	await replaceCalendarBusy(
		ctx.db,
		cal.name,
		intervals.map((i) => ({ start: i.start.toString(), end: i.end.toString() }))
	);
	await recordRefreshOutcome(ctx, cal, { at, via });

	return { ok: true, busyCount: intervals.length };
}

// A provider backing no calendars has no other source of status.
async function recordRefreshOutcome(
	ctx: WorkerContext,
	cal: ResolvedCalendar,
	outcome: ServiceOutcome
): Promise<void> {
	await recordServiceOutcome(ctx.db, { kind: 'calendar', name: cal.name }, outcome);
	await recordServiceOutcome(ctx.db, { kind: 'provider', name: cal.providerName }, outcome);
}
