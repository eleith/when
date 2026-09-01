import { expect, test } from 'vitest';
import { parseBusyEvents } from './parse.js';

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

const recurring = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:weekly-1@test
DTSTAMP:20260101T000000Z
DTSTART:20260106T130000Z
DTEND:20260106T140000Z
RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=TU
EXDATE:20260120T130000Z
SUMMARY:Weekly sync
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
	const busy = parseBusyEvents(single);
	expect(busy).toHaveLength(1);
	expect(busy[0].uid).toBe('event-1@test');
	expect(busy[0].start.toString()).toBe('2026-04-15T14:00:00Z');
	expect(busy[0].end.toString()).toBe('2026-04-15T15:00:00Z');
	expect(busy[0].rrule).toBeUndefined();
});

test('parses VEVENT with DURATION instead of DTEND', () => {
	const busy = parseBusyEvents(withDuration);
	expect(busy).toHaveLength(1);
	expect(busy[0].start.toString()).toBe('2026-04-20T09:00:00Z');
	expect(busy[0].end.toString()).toBe('2026-04-20T09:45:00Z');
});

test('captures RRULE and EXDATE on a recurring master', () => {
	const busy = parseBusyEvents(recurring);
	expect(busy).toHaveLength(1);
	expect(busy[0].rrule?.frequency).toBe('WEEKLY');
	expect(busy[0].rrule?.count).toBe(4);
	expect(busy[0].exdates).toHaveLength(1);
	expect(busy[0].exdates?.[0].toString()).toBe('2026-01-20T13:00:00Z');
});

test('captures RECURRENCE-ID on an override VEVENT', () => {
	const busy = parseBusyEvents(overrideOccurrence);
	expect(busy).toHaveLength(1);
	expect(busy[0].recurrenceId?.toString()).toBe('2026-01-13T13:00:00Z');
	expect(busy[0].rrule).toBeUndefined();
});

test('parses multiple VEVENTs preserving order', () => {
	const busy = parseBusyEvents(multipleEvents);
	expect(busy).toHaveLength(2);
	expect(busy[0].uid).toBe('a@test');
	expect(busy[1].uid).toBe('b@test');
});

test('returns empty list on completely malformed input', () => {
	expect(parseBusyEvents('not an ics calendar')).toEqual([]);
});

test('returns empty list on empty calendar', () => {
	const empty = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//test//EN\nEND:VCALENDAR`;
	expect(parseBusyEvents(empty)).toEqual([]);
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
	expect(parseBusyEvents(transparent)).toEqual([]);
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
	const busy = parseBusyEvents(opaque);
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
	expect(parseBusyEvents(cancelled)).toEqual([]);
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
	const busy = parseBusyEvents(alldayWithEnd);
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
	const busy = parseBusyEvents(alldayNoEnd);
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
	const busy = parseBusyEvents(timedNoEnd);
	expect(busy).toHaveLength(1);
	expect(busy[0].uid).toBe('timed-noend@test');
	expect(busy[0].start.toString()).toBe('2026-04-15T14:00:00Z');
	expect(busy[0].end.toString()).toBe('2026-04-15T14:00:00Z');
});
