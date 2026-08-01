import type { Calendar } from '@when/config';
import type { Interval } from './types.js';
import type { ExpandWindow } from './expand.js';
import { getCalendarAdapter, type ConnectedProvider } from './adapter.js';
import { expandBusy } from './expand.js';

export async function fetchBusyIntervals(
	cal: Calendar,
	window: ExpandWindow,
	opts: { services?: ConnectedProvider[]; excludeUids?: Set<string> } = {}
): Promise<Interval[]> {
	const adapter = getCalendarAdapter(cal, opts.services);
	const events = await adapter.fetchBusy(window);
	const exclude = opts.excludeUids;
	const kept = exclude ? events.filter((e) => !exclude.has(e.uid)) : events;
	return expandBusy(kept, window).map((o) => ({ start: o.start, end: o.end }));
}
