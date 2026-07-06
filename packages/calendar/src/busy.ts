import type { Calendar, WhenConfiguration } from '@when/config';
import type { Interval } from './types.js';
import type { ExpandWindow } from './expand.js';
import { getCalendarAdapter } from './adapter.js';
import { expandBusy } from './expand.js';

export async function fetchBusyIntervals(
	cal: Calendar,
	window: ExpandWindow,
	opts: { config?: WhenConfiguration; excludeUids?: Set<string> } = {}
): Promise<Interval[]> {
	const adapter = getCalendarAdapter(cal, opts.config?.services);
	const events = await adapter.fetchBusy(window);
	const exclude = opts.excludeUids;
	const kept = exclude ? events.filter((e) => !exclude.has(e.uid)) : events;
	return expandBusy(kept, window).map((o) => ({ start: o.start, end: o.end }));
}
