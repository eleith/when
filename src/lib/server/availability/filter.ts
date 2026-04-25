import { Temporal } from '@js-temporal/polyfill';
import { overlapsAny } from './blocks';
import type { EventTypeKnobs, Interval } from './types';

export interface FilterContext {
	blocks: Interval[];
	knobs: EventTypeKnobs;
	now: Temporal.Instant;
	userTz: string;
	/** count of active bookings keyed by user_tz YYYY-MM-DD */
	perDayCount: Map<string, number>;
}

export function filterSlots(slots: Temporal.Instant[], ctx: FilterContext): Temporal.Instant[] {
	const { blocks, knobs, now, userTz, perDayCount } = ctx;
	const earliest = now.add({ minutes: knobs.minimum_notice });
	const latest = lookaheadEnd(now, knobs.maximum_lookahead, userTz);

	return slots.filter((s) => {
		if (Temporal.Instant.compare(s, earliest) < 0) return false;
		if (Temporal.Instant.compare(s, latest) > 0) return false;

		const buffered: Interval = {
			start: s.subtract({ minutes: knobs.buffer_before }),
			end: s.add({ minutes: knobs.duration + knobs.buffer_after })
		};
		if (overlapsAny(buffered, blocks)) return false;

		if (knobs.max_bookings_per_day !== null) {
			const dateStr = s.toZonedDateTimeISO(userTz).toPlainDate().toString();
			const count = perDayCount.get(dateStr) ?? 0;
			if (count >= knobs.max_bookings_per_day) return false;
		}

		return true;
	});
}

function lookaheadEnd(now: Temporal.Instant, days: number, tz: string): Temporal.Instant {
	const today = now.toZonedDateTimeISO(tz).toPlainDate();
	const target = today.add({ days });
	return target
		.toZonedDateTime({
			timeZone: tz,
			plainTime: Temporal.PlainTime.from('23:59:59.999999999')
		})
		.toInstant();
}
