import type { Calendar } from '@when/config';
import type { Interval } from './types.js';
import type { ExpandWindow } from './expand.js';
import type { FetchFn } from './adapter.js';
import { getCalendarAdapter } from './adapter.js';
import { expandBusy } from './expand.js';

export async function fetchBusyIntervals(
	cal: Calendar,
	window: ExpandWindow,
	opts: { excludeUids?: Set<string>; fetchImpl?: FetchFn } = {}
): Promise<Interval[]> {
	const adapter = getCalendarAdapter(cal);
	const events = await adapter.fetchBusy(window, { fetchImpl: opts.fetchImpl });
	const exclude = opts.excludeUids;
	const kept = exclude ? events.filter((e) => !exclude.has(e.uid)) : events;
	return expandBusy(kept, window).map((o) => ({ start: o.start, end: o.end }));
}
