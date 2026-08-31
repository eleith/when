import { convertIcsCalendar, getEventEnd, type IcsEvent } from 'ts-ics';
import { logger } from './logger.js';
import type { BusyEvent } from './types.js';

/**
 * Parse a VCALENDAR string into BusyEvents. Tolerates malformed input by
 * skipping events that fail to convert and logging at warn level.
 */
export function parseBusyEvents(icsString: string): BusyEvent[] {
	let calendar;
	try {
		calendar = convertIcsCalendar(undefined, icsString);
	} catch (err) {
		logger.warn({ err }, 'failed to parse VCALENDAR; treating as no events');
		return [];
	}

	const events = calendar.events ?? [];
	const out: BusyEvent[] = [];
	for (const event of events) {
		const busy = toBusy(event);
		if (busy) out.push(busy);
	}
	return out;
}

function toBusy(event: IcsEvent): BusyEvent | null {
	if (event.status === 'CANCELLED') return null;
	if (event.timeTransparent === 'TRANSPARENT') return null;

	try {
		const startMs = event.start.date.getTime();
		const endMs = getEventEnd(event).getTime();
		return {
			uid: event.uid,
			start: Temporal.Instant.fromEpochMilliseconds(startMs),
			end: Temporal.Instant.fromEpochMilliseconds(endMs),
			rrule: event.recurrenceRule,
			exdates: event.exceptionDates?.map((d) =>
				Temporal.Instant.fromEpochMilliseconds(d.date.getTime())
			),
			recurrenceId: event.recurrenceId
				? Temporal.Instant.fromEpochMilliseconds(event.recurrenceId.value.date.getTime())
				: undefined
		};
	} catch (err) {
		logger.warn({ err, uid: event.uid }, 'failed to normalize VEVENT; skipping');
		return null;
	}
}
