import type { ResolvedCalendar } from '@when/config';
import type { BusyWindow, Interval } from './types.js';
import { getCalendarAdapter } from './adapter.js';

export async function fetchBusyIntervals(
	cal: ResolvedCalendar,
	window: BusyWindow,
	opts: { excludeUids?: Set<string> } = {}
): Promise<Interval[]> {
	const adapter = getCalendarAdapter(cal);
	const events = await adapter.fetchBusy(window);
	const exclude = opts.excludeUids;
	return events
		.filter((event) => !exclude?.has(event.uid))
		.filter(
			({ start, end }) =>
				Temporal.Instant.compare(start, end) < 0 &&
				Temporal.Instant.compare(start, window.end) < 0 &&
				Temporal.Instant.compare(end, window.start) > 0
		)
		.map(({ start, end }) => ({ start, end }));
}
