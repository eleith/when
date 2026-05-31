import { Temporal } from '@js-temporal/polyfill';
import { extendByRecurrenceRule } from 'ts-ics';
import type { BusyEvent } from './types';

export interface BusyOccurrence {
	uid: string;
	start: Temporal.Instant;
	end: Temporal.Instant;
}

export interface ExpandWindow {
	start: Temporal.Instant;
	end: Temporal.Instant;
}

/**
 * Flatten BusyEvents into concrete occurrences within `window`. Recurring
 * masters are expanded via their RRULE (honoring EXDATE). Overrides
 * (VEVENTs sharing a UID with a RECURRENCE-ID matching a generated
 * occurrence) replace that occurrence; orphan overrides are still
 * emitted if they fall in the window.
 */
export function expandBusy(events: BusyEvent[], window: ExpandWindow): BusyOccurrence[] {
	const overrides = new Map<string, BusyEvent>();
	for (const e of events) {
		if (e.recurrenceId) overrides.set(overrideKey(e.uid, e.recurrenceId), e);
	}

	const out: BusyOccurrence[] = [];

	for (const e of events) {
		if (e.recurrenceId) continue;

		if (!e.rrule) {
			if (intersects(e.start, e.end, window)) {
				out.push({ uid: e.uid, start: e.start, end: e.end });
			}
			continue;
		}

		const exceptions = (e.exdates ?? []).map((i) => new Date(i.epochMilliseconds));
		const dates = extendByRecurrenceRule(e.rrule, {
			start: new Date(e.start.epochMilliseconds),
			end: new Date(window.end.epochMilliseconds),
			exceptions
		});

		const durationMs = e.end.epochMilliseconds - e.start.epochMilliseconds;
		for (const d of dates) {
			const occStart = Temporal.Instant.fromEpochMilliseconds(d.getTime());
			const key = overrideKey(e.uid, occStart);
			const override = overrides.get(key);
			if (override) {
				overrides.delete(key);
				if (intersects(override.start, override.end, window)) {
					out.push({ uid: override.uid, start: override.start, end: override.end });
				}
				continue;
			}
			const occEnd = Temporal.Instant.fromEpochMilliseconds(d.getTime() + durationMs);
			if (intersects(occStart, occEnd, window)) {
				out.push({ uid: e.uid, start: occStart, end: occEnd });
			}
		}
	}

	for (const ov of overrides.values()) {
		if (intersects(ov.start, ov.end, window)) {
			out.push({ uid: ov.uid, start: ov.start, end: ov.end });
		}
	}

	return out;
}

function overrideKey(uid: string, recurrenceId: Temporal.Instant): string {
	return `${uid}@${recurrenceId.epochMilliseconds}`;
}

function intersects(start: Temporal.Instant, end: Temporal.Instant, w: ExpandWindow): boolean {
	return Temporal.Instant.compare(start, w.end) < 0 && Temporal.Instant.compare(end, w.start) > 0;
}
