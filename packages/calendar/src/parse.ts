import { convertIcsDuration, convertIcsTimeStamp } from 'ts-ics';
import type { BusyEvent } from './types.js';

/** Read concrete CalDAV occurrences; never turn a failed import into an empty calendar. */
export function parseExpandedCalDavEvents(icsString: string): BusyEvent[] {
	const events = prepareExpandedCalendar(icsString);
	const out: BusyEvent[] = [];
	for (const fields of events) {
		if (
			fields.get('STATUS')?.value === 'CANCELLED' ||
			fields.get('TRANSP')?.value === 'TRANSPARENT'
		)
			continue;
		// Preparation has checked the required fields of each active event.
		const uid = fields.get('UID')!.value;
		let start: Temporal.Instant;
		let end: Temporal.Instant;
		try {
			start = instantFromProperty(fields.get('DTSTART')!);
			end = eventEnd(fields, start);
		} catch {
			throw new Error('Invalid time in CalDAV busy event');
		}
		if (Temporal.Instant.compare(end, start) < 0) {
			throw new Error('CalDAV busy event end precedes start');
		}
		out.push({ uid, start, end });
	}
	return out;
}

interface ContentProperty {
	name: string;
	parameters: Map<string, string>;
	value: string;
}

type EventProperties = ReadonlyMap<string, ContentProperty>;

const busyFields = new Set([
	'DTSTART',
	'DTEND',
	'DURATION',
	'UID',
	'RECURRENCE-ID',
	'STATUS',
	'TRANSP'
]);

/** Read and validate event properties once; only individual time values go through ts-ics. */
function prepareExpandedCalendar(icsString: string): EventProperties[] {
	const lines = icsString
		.trim()
		.replace(/\r\n?/g, '\n')
		.replace(/\n[ \t]/g, '')
		.split('\n');
	const stack: string[] = [];
	const events: EventProperties[] = [];
	let roots = 0;
	let version: string | undefined;
	let fields = new Map<string, ContentProperty>();
	for (const line of lines) {
		const property = readContentProperty(line);
		const { name, parameters } = property;
		if (name === 'BEGIN' || name === 'END') {
			const component = property.value.toUpperCase();
			if (parameters.size || !/^[A-Z0-9-]+$/.test(component)) {
				throw new Error('Invalid CalDAV calendar data');
			}
			if (component === 'VTIMEZONE') {
				throw new Error('CalDAV server did not return expanded occurrences');
			}
			if (name === 'BEGIN') {
				// This reader consumes the requested event/alarm hierarchy, not arbitrary ICS components.
				if (component !== ['VCALENDAR', 'VEVENT', 'VALARM'][stack.length]) {
					throw new Error('Invalid CalDAV calendar data: unexpected component hierarchy');
				}
				if (stack.length === 0 && ++roots !== 1) {
					throw new Error('Invalid CalDAV calendar data');
				}
				if (component === 'VEVENT') fields = new Map();
				stack.push(component);
			} else {
				if (stack.pop() !== component) throw new Error('Invalid CalDAV calendar data');
				if (component === 'VEVENT') {
					validateBusyFields(fields);
					events.push(fields);
				}
			}
			continue;
		}
		if (!stack.length) throw new Error('Invalid CalDAV calendar data');
		if (stack.at(-1) === 'VCALENDAR' && name === 'VERSION') version = property.value;
		if (/^(RRULE|RDATE|EXRULE|EXDATE)$/.test(name) || parameters.has('TZID')) {
			throw new Error('CalDAV server did not return expanded occurrences');
		}
		// Alarm DURATION/TRIGGER belong to the alarm, not the enclosing event.
		if (stack.at(-1) === 'VEVENT' && busyFields.has(name)) {
			if (fields.has(name)) throw new Error(`Duplicate ${name} in CalDAV busy event`);
			normalizeBusyProperty(property);
			fields.set(name, property);
		}
	}
	if (roots !== 1 || stack.length || version !== '2.0') {
		throw new Error('Invalid CalDAV calendar data');
	}
	return events;
}

function readContentProperty(line: string): ContentProperty {
	// Only CR/LF delimit content lines; Unicode line/paragraph separators remain value text.
	const property =
		/^([a-z0-9-]+)((?:;[a-z0-9-]+=(?:"[^"\n]*"|[^;:",\n]*)(?:,(?:"[^"\n]*"|[^;:",\n]*))*)*):([^\r\n]*)$/i.exec(
			line
		);
	if (!property) throw new Error('Invalid CalDAV calendar data: invalid content line');
	const [, name, rawParameters, value] = property;
	const parameters = new Map<string, string>();
	for (const match of rawParameters.matchAll(/;([a-z0-9-]+)=((?:[^;:"]|"[^"]*")*)/gi)) {
		const [, key, rawValue] = match;
		const field = key.toUpperCase();
		if (parameters.has(field)) throw new Error('Duplicate CalDAV property parameter');
		const parameterValue = rawValue.replace(/^"([^"]*)"$/, '$1');
		parameters.set(field, field === 'VALUE' ? parameterValue.toUpperCase() : parameterValue);
	}
	return { name: name.toUpperCase(), parameters, value };
}

function normalizeBusyProperty(property: ContentProperty): void {
	const { name, parameters } = property;
	if (name === 'STATUS' || name === 'TRANSP') {
		property.value = property.value.toUpperCase();
	} else if (name === 'DURATION') {
		property.value = normalizeBusyDuration(
			property.value.toUpperCase(),
			parameters.get('VALUE') ?? 'DURATION'
		);
	} else if (name === 'DTSTART' || name === 'DTEND' || name === 'RECURRENCE-ID') {
		property.value = property.value.toUpperCase();
		validateBusyDate(property.value, parameters.get('VALUE') ?? 'DATE-TIME', name);
	}
}

function validateBusyFields(fields: Map<string, ContentProperty>): void {
	const start = fields.get('DTSTART');
	const end = fields.get('DTEND');
	const duration = fields.get('DURATION');
	if (end && duration) throw new Error('CalDAV busy event has both DTEND and DURATION');
	const startKind = start?.parameters.get('VALUE') ?? 'DATE-TIME';
	if (end && startKind !== (end.parameters.get('VALUE') ?? 'DATE-TIME')) {
		throw new Error('CalDAV busy event DTSTART and DTEND VALUE kinds differ');
	}
	if (startKind === 'DATE' && duration?.value.includes('T')) {
		throw new Error('CalDAV busy event DATE duration must use only weeks or days');
	}
	if (fields.get('STATUS')?.value === 'CANCELLED' || fields.get('TRANSP')?.value === 'TRANSPARENT')
		return;
	if (!fields.get('UID')?.value.trim()) throw new Error('CalDAV busy event is missing its UID');
	if (!start) throw new Error('CalDAV busy event is missing DTSTART');
}

function normalizeBusyDuration(value: string, kind: string): string {
	if (kind !== 'DURATION') throw new Error('Invalid duration VALUE in CalDAV busy event');
	const duration = /^\+?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/.exec(
		value
	);
	if (!duration) throw new Error('Invalid duration in CalDAV busy event');
	const [, weeks, days, hours, minutes, seconds] = duration;
	const hasComponent = [weeks, days, hours, minutes, seconds].some((part) => part !== undefined);
	const hasTimeComponent = [hours, minutes, seconds].some((part) => part !== undefined);
	if (!hasComponent || (value.includes('T') && !hasTimeComponent)) {
		throw new Error('Empty duration component in CalDAV busy event');
	}
	// An explicit positive sign is legal ICS, but ts-ics misparses it.
	return value.replace(/^\+/, '');
}

function validateBusyDate(value: string, kind: string, property: string): void {
	const date = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
	if (!date || (kind !== 'DATE' && kind !== 'DATE-TIME')) {
		throw new Error(`Invalid time in CalDAV busy event (${property})`);
	}
	const [, year, month, day, hour, minute, second] = date;
	const hasTime = hour !== undefined;
	const expectsTime = kind === 'DATE-TIME';
	if (hasTime !== expectsTime) throw new Error(`Invalid time in CalDAV busy event (${property})`);
	const isoDate = `${year}-${month}-${day}`;
	try {
		if (kind === 'DATE') Temporal.PlainDate.from(isoDate);
		else Temporal.PlainDateTime.from(`${isoDate}T${hour}:${minute}:${second}`);
	} catch {
		throw new Error(`Invalid time in CalDAV busy event (${property})`);
	}
}

function instantFromProperty(property: ContentProperty): Temporal.Instant {
	const timestamp = convertIcsTimeStamp(undefined, {
		value: property.value,
		options: Object.fromEntries(property.parameters)
	});
	return Temporal.Instant.fromEpochMilliseconds(timestamp.date.getTime());
}

function eventEnd(fields: EventProperties, start: Temporal.Instant): Temporal.Instant {
	const end = fields.get('DTEND');
	if (end) return instantFromProperty(end);
	const durationProperty = fields.get('DURATION');
	if (durationProperty) {
		const duration = convertIcsDuration(undefined, { value: durationProperty.value });
		return start.add({
			hours: (duration.weeks ?? 0) * 168 + (duration.days ?? 0) * 24 + (duration.hours ?? 0),
			minutes: duration.minutes ?? 0,
			seconds: duration.seconds ?? 0
		});
	}
	// DATE and floating DATE-TIME retain the existing UTC interpretation. A DATE
	// without an end lasts one day; a DATE-TIME without an end has zero duration.
	return fields.get('DTSTART')!.parameters.get('VALUE') === 'DATE'
		? start.add({ hours: 24 })
		: start;
}
