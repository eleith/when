import { Temporal } from '@js-temporal/polyfill';
import type { Calendar } from '../config/schema';
import { logger } from '../logger';
import type { Interval } from '../availability/types';
import type { FetchFn } from './adapters/caldav';
import { expandBusy, type ExpandWindow } from './expand';
import { getCalendarAdapter } from './adapter';

interface CacheEntry {
	intervals: Interval[];
	expiresMs: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export function clearConflictCache(): void {
	cache.clear();
}

function cacheKey(calendarId: string, window: ExpandWindow): string {
	return `${calendarId}|${window.start.epochMilliseconds}|${window.end.epochMilliseconds}`;
}

export interface PullOptions {
	/** Override the cache clock (ms since epoch). Defaults to Date.now(). */
	now?: number;
	/** Bypass the in-process cache; use for the booking-submit re-validation. */
	bypassCache?: boolean;
	/** Inject fetch for testing. */
	fetchImpl?: FetchFn;
}

/**
 * Pull busy intervals from the named conflict calendars within `window`.
 * Network failures are logged and treated as empty so a single broken
 * calendar doesn't block availability.
 */
export async function pullConflictBusy(
	calendars: Calendar[],
	conflictCalendarIds: string[],
	window: ExpandWindow,
	opts: PullOptions = {}
): Promise<Interval[]> {
	const now = opts.now ?? Date.now();
	const out: Interval[] = [];

	for (const id of conflictCalendarIds) {
		const cal = calendars.find((c) => c.id === id);
		if (!cal) {
			logger.warn({ id }, 'unknown conflict_calendar id; skipping');
			continue;
		}

		const key = cacheKey(id, window);
		if (!opts.bypassCache) {
			const hit = cache.get(key);
			if (hit && hit.expiresMs > now) {
				out.push(...hit.intervals);
				continue;
			}
		}

		try {
			const adapter = getCalendarAdapter(cal);
			const events = await adapter.fetchBusy(window, { fetchImpl: opts.fetchImpl });

			const occurrences = expandBusy(events, window);
			const intervals: Interval[] = occurrences.map((o) => ({ start: o.start, end: o.end }));
			cache.set(key, { intervals, expiresMs: now + CACHE_TTL_MS });
			out.push(...intervals);
		} catch (err) {
			logger.error({ err, calendarId: id }, `${cal.type} conflict fetch failed; treating as empty`);
		}
	}

	return out;
}

/**
 * Page-render conflict-pull window: from `now` to the end of the visible
 * month + 2 weeks (per spec), but never beyond `now + maxLookaheadDays`.
 * The submit-time slot-day re-fetch (with `bypassCache`) catches any
 * busy events past this window before persisting a booking.
 */
export function conflictPullWindow(
	now: Temporal.Instant,
	userTz: string,
	maxLookaheadDays: number
): ExpandWindow {
	const today = now.toZonedDateTimeISO(userTz).toPlainDate();
	const startOfNextMonth = today.with({ day: 1 }).add({ months: 1 });
	const cap = startOfNextMonth.add({ weeks: 2 }).toZonedDateTime(userTz).toInstant();
	const lookaheadEnd = now.add({ hours: 24 * maxLookaheadDays });
	const end = Temporal.Instant.compare(cap, lookaheadEnd) < 0 ? cap : lookaheadEnd;
	return { start: now, end };
}
