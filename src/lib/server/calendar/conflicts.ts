import type { CalDavCalendar, Calendar } from '../config/schema';
import { logger } from '../logger';
import type { Interval } from '../availability/types';
import { fetchCalDavBusy, type FetchFn } from './caldav';
import { expandBusy, type ExpandWindow } from './expand';

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
 * Non-CalDAV calendars (e.g. Google) are silently skipped — Google
 * support is deferred. Network failures are logged and treated as empty
 * so a single broken calendar doesn't block availability.
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
		if (cal.type !== 'caldav') {
			logger.debug({ id, type: cal.type }, 'skipping non-CalDAV calendar (Google deferred)');
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
			const events = await fetchCalDavBusy(
				toCalDavConfig(cal),
				{ start: window.start, end: window.end },
				opts.fetchImpl
			);
			const occurrences = expandBusy(events, window);
			const intervals: Interval[] = occurrences.map((o) => ({ start: o.start, end: o.end }));
			cache.set(key, { intervals, expiresMs: now + CACHE_TTL_MS });
			out.push(...intervals);
		} catch (err) {
			logger.error({ err, calendarId: id }, 'CalDAV conflict fetch failed; treating as empty');
		}
	}

	return out;
}

function toCalDavConfig(cal: CalDavCalendar): { url: string; username: string; password: string } {
	return { url: cal.url, username: cal.username, password: cal.password };
}
