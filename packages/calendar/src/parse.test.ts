import { expect, test, vi } from 'vitest';
import { parseExpandedCalDavEvents } from './parse.js';

const single = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:event-1@test
DTSTAMP:20260101T000000Z
DTSTART:20260415T140000Z
DTEND:20260415T150000Z
SUMMARY:Lunch
END:VEVENT
END:VCALENDAR`;

const withDuration = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:event-2@test
DTSTAMP:20260101T000000Z
DTSTART:20260420T090000Z
DURATION:PT45M
SUMMARY:Standup
END:VEVENT
END:VCALENDAR`;

const overrideOccurrence = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:weekly-1@test
DTSTAMP:20260101T000000Z
DTSTART:20260113T140000Z
DTEND:20260113T150000Z
RECURRENCE-ID:20260113T130000Z
SUMMARY:Weekly sync (moved)
END:VEVENT
END:VCALENDAR`;

const multipleEvents = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:a@test
DTSTAMP:20260101T000000Z
DTSTART:20260415T140000Z
DTEND:20260415T150000Z
SUMMARY:A
END:VEVENT
BEGIN:VEVENT
UID:b@test
DTSTAMP:20260101T000000Z
DTSTART:20260416T090000Z
DTEND:20260416T093000Z
SUMMARY:B
END:VEVENT
END:VCALENDAR`;

test('parses a single VEVENT with DTSTART/DTEND', () => {
	const busy = parseExpandedCalDavEvents(single);
	expect(busy).toHaveLength(1);
	expect(busy[0].uid).toBe('event-1@test');
	expect(busy[0].start.toString()).toBe('2026-04-15T14:00:00Z');
	expect(busy[0].end.toString()).toBe('2026-04-15T15:00:00Z');
});

test('parses VEVENT with DURATION instead of DTEND', () => {
	const busy = parseExpandedCalDavEvents(withDuration);
	expect(busy).toHaveLength(1);
	expect(busy[0].start.toString()).toBe('2026-04-20T09:00:00Z');
	expect(busy[0].end.toString()).toBe('2026-04-20T09:45:00Z');
});

test.each([
	'RRULE:FREQ=WEEKLY;COUNT=4',
	'RDATE:20260416T140000Z',
	'EXDATE:20260415T140000Z',
	'EXRULE:FREQ=DAILY'
])('rejects an unexpanded %s instead of importing only the master', (property) => {
	const unexpanded = single.replace('SUMMARY:Lunch', `${property}\nSUMMARY:Lunch`);
	expect(() => parseExpandedCalDavEvents(unexpanded)).toThrow(
		/did not return expanded occurrences/
	);
});

test('rejects unresolved timezone references and definitions', () => {
	const zoned = single.replace(
		'DTSTART:20260415T140000Z',
		'DTSTART;TZID=America/New_York:20260415T100000'
	);
	const withZone = single.replace(
		'BEGIN:VEVENT',
		'BEGIN:VTIMEZONE\nTZID:America/New_York\nEND:VTIMEZONE\nBEGIN:VEVENT'
	);
	expect(() => parseExpandedCalDavEvents(zoned)).toThrow(/did not return expanded occurrences/);
	expect(() => parseExpandedCalDavEvents(withZone)).toThrow(/did not return expanded occurrences/);
});

test('uses a moved occurrence’s actual bounds, not its RECURRENCE-ID', () => {
	const busy = parseExpandedCalDavEvents(overrideOccurrence);
	expect(busy).toHaveLength(1);
	expect(busy[0].start.toString()).toBe('2026-01-13T14:00:00Z');
	expect(busy[0].end.toString()).toBe('2026-01-13T15:00:00Z');
});

test('parses multiple VEVENTs preserving order', () => {
	const busy = parseExpandedCalDavEvents(multipleEvents);
	expect(busy).toHaveLength(2);
	expect(busy[0].uid).toBe('a@test');
	expect(busy[1].uid).toBe('b@test');
});

test('rejects malformed calendar data rather than reporting an empty calendar', () => {
	expect(() => parseExpandedCalDavEvents('not an ics calendar')).toThrow(
		/Invalid CalDAV calendar data/
	);
	expect(() => parseExpandedCalDavEvents(single.replace('END:VEVENT\n', ''))).toThrow(
		/Invalid CalDAV calendar data/
	);
});

test('one malformed busy event rejects the whole calendar instead of silently dropping it', () => {
	const invalid = multipleEvents.replace('DTSTART:20260416T090000Z', 'DTSTART:invalid');
	expect(() => parseExpandedCalDavEvents(invalid)).toThrow(/Invalid time/);
});

test('rejects missing identity and negative time intervals', () => {
	expect(() => parseExpandedCalDavEvents(single.replace('UID:event-1@test\n', ''))).toThrow(
		/missing its UID/
	);
	expect(() =>
		parseExpandedCalDavEvents(single.replace('DTEND:20260415T150000Z', 'DTEND:20260415T130000Z'))
	).toThrow(/end precedes start/);
});

test.each([
	{ name: 'an impossible date', source: single.replaceAll('20260415', '20260230') },
	{ name: 'a malformed duration', source: withDuration.replace('PT45M', 'garbage') }
])('rejects $name before the parser can normalize it into a different interval', ({ source }) => {
	expect(() => parseExpandedCalDavEvents(source)).toThrow(/CalDAV busy event/);
});

test.each([
	['+P1D', '2026-04-21T09:00:00Z'],
	['+P1W', '2026-04-27T09:00:00Z']
])('accepts the explicit positive duration %s', (duration, expectedEnd) => {
	const [busy] = parseExpandedCalDavEvents(withDuration.replace('PT45M', duration));
	expect(busy.end.toString()).toBe(expectedEnd);
});

test('floating DATE-TIME values use the same UTC interpretation requested from the server', () => {
	vi.stubEnv('TZ', 'Asia/Tokyo');
	try {
		const source = single
			.replace('20260415T140000Z', '20260415T140000')
			.replace('20260415T150000Z', '20260415T150000');
		const [busy] = parseExpandedCalDavEvents(source);
		expect(busy.start.toString()).toBe('2026-04-15T14:00:00Z');
		expect(busy.end.toString()).toBe('2026-04-15T15:00:00Z');
	} finally {
		vi.unstubAllEnvs();
	}
});

test('DURATION uses elapsed UTC time even across the host’s DST boundary', () => {
	vi.stubEnv('TZ', 'America/New_York');
	try {
		const source = withDuration
			.replace('20260420T090000Z', '20260307T120000Z')
			.replace('PT45M', 'P2D');
		const [busy] = parseExpandedCalDavEvents(source);
		expect(busy.end.toString()).toBe('2026-03-09T12:00:00Z');
	} finally {
		vi.unstubAllEnvs();
	}
});

test('component-marker text in a description cannot truncate a later duration', () => {
	const source = withDuration.replace(
		'DURATION:PT45M',
		'DESCRIPTION:Discuss END:VEVENT handling\nDURATION:PT45M'
	);
	const [busy] = parseExpandedCalDavEvents(source);
	expect(busy.start.toString()).toBe('2026-04-20T09:00:00Z');
	expect(busy.end.toString()).toBe('2026-04-20T09:45:00Z');
});

test.each(['STATUS:CANCELLED', 'TRANSP:TRANSPARENT'])(
	'component-marker text cannot hide a later %s',
	(property) => {
		const source = single.replace(
			'SUMMARY:Lunch',
			`DESCRIPTION:Discuss END:VEVENT handling\n${property}`
		);
		expect(parseExpandedCalDavEvents(source)).toEqual([]);
	}
);

test('component-marker text in an opaque UID is preserved', () => {
	const uid = 'Mixed-END:VEVENT-ID@Test';
	const [busy] = parseExpandedCalDavEvents(single.replace('event-1@test', uid));
	expect(busy.uid).toBe(uid);
	expect(busy.start.toString()).toBe('2026-04-15T14:00:00Z');
	expect(busy.end.toString()).toBe('2026-04-15T15:00:00Z');
});

test.each([
	['missing', single.replace('VERSION:2.0\n', '')],
	['unsupported', single.replace('VERSION:2.0', 'VERSION:1.0')],
	[
		'only inside an event',
		single.replace('VERSION:2.0\n', '').replace('SUMMARY:Lunch', 'VERSION:2.0')
	]
])('rejects a calendar whose version is %s', (_name, source) => {
	expect(() => parseExpandedCalDavEvents(source)).toThrow(/Invalid CalDAV calendar data/);
});

test('returns empty list on empty calendar', () => {
	const empty = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//test//EN\nEND:VCALENDAR`;
	expect(parseExpandedCalDavEvents(empty)).toEqual([]);
});

test('ignores events with TRANSP:TRANSPARENT (free)', () => {
	const transparent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:free@test
DTSTAMP:20260101T000000Z
DTSTART:20260415T140000Z
DTEND:20260415T150000Z
TRANSP:TRANSPARENT
SUMMARY:Free event
END:VEVENT
END:VCALENDAR`;
	expect(parseExpandedCalDavEvents(transparent)).toEqual([]);
});

test('includes events with TRANSP:OPAQUE (busy)', () => {
	const opaque = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:busy@test
DTSTAMP:20260101T000000Z
DTSTART:20260415T140000Z
DTEND:20260415T150000Z
TRANSP:OPAQUE
SUMMARY:Busy event
END:VEVENT
END:VCALENDAR`;
	const busy = parseExpandedCalDavEvents(opaque);
	expect(busy).toHaveLength(1);
	expect(busy[0].uid).toBe('busy@test');
});

test('ignores events with STATUS:CANCELLED', () => {
	const cancelled = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:cancelled@test
DTSTAMP:20260101T000000Z
DTSTART:20260415T140000Z
DTEND:20260415T150000Z
STATUS:CANCELLED
SUMMARY:Cancelled event
END:VEVENT
END:VCALENDAR`;
	expect(parseExpandedCalDavEvents(cancelled)).toEqual([]);
});

test('parses all-day event with explicit DTEND', () => {
	const alldayWithEnd = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:allday-end@test
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20260415
DTEND;VALUE=DATE:20260416
SUMMARY:All day with DTEND
END:VEVENT
END:VCALENDAR`;
	const busy = parseExpandedCalDavEvents(alldayWithEnd);
	expect(busy).toHaveLength(1);
	expect(busy[0].uid).toBe('allday-end@test');
	expect(busy[0].start.toString()).toBe('2026-04-15T00:00:00Z');
	expect(busy[0].end.toString()).toBe('2026-04-16T00:00:00Z');
});

test('parses single-day all-day event without DTEND (RFC 5545 default 1 day duration)', () => {
	const alldayNoEnd = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:allday-noend@test
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20260415
SUMMARY:All day single day
END:VEVENT
END:VCALENDAR`;
	const busy = parseExpandedCalDavEvents(alldayNoEnd);
	expect(busy).toHaveLength(1);
	expect(busy[0].uid).toBe('allday-noend@test');
	expect(busy[0].start.toString()).toBe('2026-04-15T00:00:00Z');
	expect(busy[0].end.toString()).toBe('2026-04-16T00:00:00Z');
});

test('parses timed event without DTEND or DURATION (0 duration)', () => {
	const timedNoEnd = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:timed-noend@test
DTSTAMP:20260101T000000Z
DTSTART:20260415T140000Z
SUMMARY:Zero duration
END:VEVENT
END:VCALENDAR`;
	const busy = parseExpandedCalDavEvents(timedNoEnd);
	expect(busy).toHaveLength(1);
	expect(busy[0].uid).toBe('timed-noend@test');
	expect(busy[0].start.toString()).toBe('2026-04-15T14:00:00Z');
	expect(busy[0].end.toString()).toBe('2026-04-15T14:00:00Z');
});

test.each([
	['unclosed VTODO', 'BEGIN:VTODO\nUID:todo@test'],
	['bare upstream failure', 'upstream failure'],
	['mismatched component end', 'BEGIN:VEVENT\nEND:VALARM'],
	['unrequested VTODO', 'BEGIN:VTODO\nEND:VTODO'],
	['standalone VALARM', 'BEGIN:VALARM\nEND:VALARM'],
	['nested VCALENDAR root', 'BEGIN:VCALENDAR\nEND:VCALENDAR']
])('rejects an apparently empty calendar containing %s', (_name, contents) => {
	const source = `BEGIN:VCALENDAR\nVERSION:2.0\n${contents}\nEND:VCALENDAR`;
	expect(() => parseExpandedCalDavEvents(source)).toThrow(/Invalid CalDAV calendar data/);
});

test('rejects multiple VCALENDAR roots rather than importing only one', () => {
	expect(() => parseExpandedCalDavEvents(`${single}\n${single}`)).toThrow(
		/Invalid CalDAV calendar data/
	);
});

test.each([
	['DTSTART', 'DTSTART:20260415T160000Z'],
	['DTEND', 'DTEND:20260415T170000Z'],
	['UID', 'uid:Other-UID@Test'],
	['DURATION', 'DURATION:PT45M\nduration:PT90M'],
	['RECURRENCE-ID', 'RECURRENCE-ID:20260415T130000Z\nrecurrence-id:20260415T140000Z'],
	['STATUS', 'STATUS:CANCELLED\nstatus:CONFIRMED'],
	['TRANSP', 'TRANSP:TRANSPARENT\ntransp:OPAQUE']
])('rejects duplicate %s before conversion can choose the last value', (name, extra) => {
	const source = single.replace('SUMMARY:Lunch', extra);
	expect(() => parseExpandedCalDavEvents(source)).toThrow(new RegExp(`Duplicate ${name}`));
});

test('rejects mutually exclusive DTEND and DURATION', () => {
	const source = single.replace('SUMMARY:Lunch', 'DURATION:PT1H');
	expect(() => parseExpandedCalDavEvents(source)).toThrow(/both DTEND and DURATION/);
});

test.each([
	['DATE start with DATE-TIME end', 'DTSTART;VALUE=DATE:20260415', 'DTEND:20260416T000000Z'],
	['DATE-TIME start with DATE end', 'DTSTART:20260415T000000Z', 'DTEND;VALUE=DATE:20260416']
])('rejects mismatched VALUE kinds: %s', (_name, start, end) => {
	const source = single
		.replace('DTSTART:20260415T140000Z', start)
		.replace('DTEND:20260415T150000Z', end);
	expect(() => parseExpandedCalDavEvents(source)).toThrow(/VALUE kinds differ/);
});

test.each(['PT24H', 'P1DT1H', 'P1DT0H'])(
	'rejects time components in a DATE duration: %s',
	(duration) => {
		const source = withDuration
			.replace('DTSTART:20260420T090000Z', 'DTSTART;VALUE=DATE:20260420')
			.replace('PT45M', duration);
		expect(() => parseExpandedCalDavEvents(source)).toThrow(
			/DATE duration must use only weeks or days/
		);
	}
);

test.each([
	['P2D', '2026-04-22T00:00:00Z'],
	['+P1W', '2026-04-27T00:00:00Z']
])('accepts week/day-only DATE duration: %s', (duration, expectedEnd) => {
	const source = withDuration
		.replace('DTSTART:20260420T090000Z', 'DTSTART;VALUE=DATE:20260420')
		.replace('PT45M', duration);
	const [busy] = parseExpandedCalDavEvents(source);
	expect(busy.end.toString()).toBe(expectedEnd);
});

test('accepts case-insensitive structural/property names while preserving UID case', () => {
	const source = single.toLowerCase().replace('uid:event-1@test', 'uId:MixedCase-ID@Test');
	const [busy] = parseExpandedCalDavEvents(source);
	expect(busy.uid).toBe('MixedCase-ID@Test');
	expect(busy.start.toString()).toBe('2026-04-15T14:00:00Z');
	expect(busy.end.toString()).toBe('2026-04-15T15:00:00Z');
});

test.each(['sTaTuS:cAnCeLlEd', 'tRaNsP:tRaNsPaReNt'])(
	'filters case-insensitive free/cancelled enum: %s',
	(property) => {
		expect(parseExpandedCalDavEvents(single.replace('SUMMARY:Lunch', property))).toEqual([]);
	}
);

test('normalizes case-insensitive VALUE parameters', () => {
	const source = single
		.replace('DTSTART:20260415T140000Z', 'dtstart;value="date":20260415')
		.replace('DTEND:20260415T150000Z', 'dtend;value=date:20260416');
	const [busy] = parseExpandedCalDavEvents(source);
	expect(busy.start.toString()).toBe('2026-04-15T00:00:00Z');
	expect(busy.end.toString()).toBe('2026-04-16T00:00:00Z');
});

test('keeps multiple expanded occurrences with the same case-sensitive UID', () => {
	const source = multipleEvents
		.replace('UID:a@test', 'UID:Series-ID@Test')
		.replace('UID:b@test', 'UID:Series-ID@Test');
	const busy = parseExpandedCalDavEvents(source);
	expect(busy.map((event) => [event.uid, event.start.toString()])).toEqual([
		['Series-ID@Test', '2026-04-15T14:00:00Z'],
		['Series-ID@Test', '2026-04-16T09:00:00Z']
	]);
});

test.each([
	[
		'VTODO inside an event',
		'BEGIN:VTODO\nUID:other\nDTSTART:20260415T010000Z\nDTEND:20260415T020000Z\nSTATUS:CANCELLED\nEND:VTODO'
	],
	['alarm inside another alarm', 'BEGIN:VALARM\nBEGIN:VALARM\nEND:VALARM\nEND:VALARM']
])('rejects %s rather than letting its fields affect the event', (_name, nested) => {
	const source = single.replace('END:VEVENT', `${nested}\nEND:VEVENT`);
	expect(() => parseExpandedCalDavEvents(source)).toThrow(/unexpected component hierarchy/);
});

test('nested VALARM DURATION and TRIGGER do not become VEVENT boundaries', () => {
	const alarm = `begin:valarm
ACTION:DISPLAY
DESCRIPTION:Mixed-case reminder
TRIGGER:-PT15M
DURATION:PT5M
REPEAT:2
end:valarm`;
	const source = withDuration.replace('SUMMARY:Standup', `${alarm}\n${alarm}`);
	const [busy] = parseExpandedCalDavEvents(source);
	expect(busy.start.toString()).toBe('2026-04-20T09:00:00Z');
	expect(busy.end.toString()).toBe('2026-04-20T09:45:00Z');
});

test('a DATE event can have a timed nested alarm without an event DURATION', () => {
	const source = single.replace('DTSTART:20260415T140000Z', 'DTSTART;VALUE=DATE:20260415').replace(
		'DTEND:20260415T150000Z',
		`BEGIN:VALARM
ACTION:DISPLAY
DESCRIPTION:Reminder
TRIGGER:-PT1H
DURATION:PT5M
REPEAT:2
END:VALARM`
	);
	const [busy] = parseExpandedCalDavEvents(source);
	expect(busy.end.toString()).toBe('2026-04-16T00:00:00Z');
});

test('accepts a genuine empty calendar with case-insensitive names', () => {
	expect(
		parseExpandedCalDavEvents(
			'begin:vcalendar\r\nversion:2.0\r\nprodid:-//Test//EN\r\nend:vcalendar\r\n'
		)
	).toEqual([]);
});
