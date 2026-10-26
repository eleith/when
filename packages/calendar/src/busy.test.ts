import { expect, test, vi, beforeEach } from 'vitest';
import type { ResolvedCalendar } from '@when/config';
import { fetchBusyIntervals } from './busy.js';
import { CalDavAdapter } from './adapters/caldav.js';

const inst = (s: string): Temporal.Instant => Temporal.Instant.from(s);
const window = { start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') };

const workDav = {
	type: 'caldav' as const,
	url: 'https://cal.example.com/work/',
	username: 'jane',
	password: 'secret',
	calendars: {}
};

const workCal: ResolvedCalendar = {
	type: 'caldav',
	name: 'work',
	providerName: 'work-dav',
	provider: workDav,
	calendar: { href: 'https://cal.example.com/work/', sync: { refresh_every_minutes: 10 } }
};

const twoEvents = `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/work/events.ics</href>
    <propstat><prop><C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//x//EN
BEGIN:VEVENT
UID:our-appt-1
DTSTAMP:20260101T000000Z
DTSTART:20260415T140000Z
DTEND:20260415T150000Z
SUMMARY:Ours
END:VEVENT
BEGIN:VEVENT
UID:other-party-1
DTSTAMP:20260101T000000Z
DTSTART:20260415T140000Z
DTEND:20260415T153000Z
SUMMARY:Other
END:VEVENT
END:VCALENDAR</C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat>
  </response>
</multistatus>`;

beforeEach(() => {
	vi.restoreAllMocks();
});

test('returns all intervals when nothing is excluded', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(twoEvents, { status: 207 }));
	const intervals = await fetchBusyIntervals(workCal, window);
	expect(intervals).toHaveLength(2);
});

test('drops our own event by uid but keeps a genuine event at the same time', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(twoEvents, { status: 207 }));
	const intervals = await fetchBusyIntervals(workCal, window, {
		excludeUids: new Set(['our-appt-1'])
	});
	expect(intervals).toHaveLength(1);
	expect(intervals[0].start.toString()).toBe('2026-04-15T14:00:00Z');
	expect(intervals[0].end.toString()).toBe('2026-04-15T15:30:00Z');
});

test('keeps each live expanded occurrence sharing a UID at the provider’s actual time', async () => {
	const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:series
DTSTAMP:20260101T000000Z
DTSTART:20260303T140000Z
DTEND:20260303T150000Z
END:VEVENT
BEGIN:VEVENT
UID:series
DTSTAMP:20260101T000000Z
RECURRENCE-ID:20260310T130000Z
DTSTART:20260310T130000Z
DTEND:20260310T140000Z
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:series
DTSTAMP:20260101T000000Z
RECURRENCE-ID:20260317T130000Z
DTSTART:20260317T153000Z
DTEND:20260317T163000Z
END:VEVENT
BEGIN:VEVENT
UID:series
DTSTAMP:20260101T000000Z
RECURRENCE-ID:20260324T130000Z
DTSTART:20260324T130000Z
DTEND:20260324T140000Z
END:VEVENT
END:VCALENDAR`;
	// Same response shape observed from Nextcloud, using synthetic event data only.
	const xml = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
<d:response><d:href>/work/series.ics</d:href><d:propstat><d:prop>
<c:calendar-data>${ics.replaceAll('\n', '&#13;\n')}</c:calendar-data>
</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
	const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(xml, { status: 207 }));
	const march = { start: inst('2026-03-01T00:00:00Z'), end: inst('2026-04-01T00:00:00Z') };

	const intervals = await fetchBusyIntervals(workCal, march);
	expect(intervals.map(({ start, end }) => [start.toString(), end.toString()])).toEqual([
		['2026-03-03T14:00:00Z', '2026-03-03T15:00:00Z'],
		['2026-03-17T15:30:00Z', '2026-03-17T16:30:00Z'],
		['2026-03-24T13:00:00Z', '2026-03-24T14:00:00Z']
	]);
	fetch.mockResolvedValue(new Response(xml, { status: 207 }));
	const excluded = await fetchBusyIntervals(workCal, march, { excludeUids: new Set(['series']) });
	expect(excluded).toEqual([]);
});

test('keeps overlapping intervals without clipping, but drops touching and zero-length intervals', async () => {
	const times = [
		['2026-03-31T22:00:00Z', '2026-03-31T23:00:00Z'],
		['2026-03-31T23:00:00Z', '2026-04-01T00:00:00Z'],
		['2026-03-31T23:30:00Z', '2026-04-01T00:30:00Z'],
		['2026-04-15T10:00:00Z', '2026-04-15T11:00:00Z'],
		['2026-04-15T12:00:00Z', '2026-04-15T12:00:00Z'],
		['2026-04-30T23:30:00Z', '2026-05-01T00:30:00Z'],
		['2026-05-01T00:00:00Z', '2026-05-01T01:00:00Z']
	];
	vi.spyOn(CalDavAdapter.prototype, 'fetchBusy').mockResolvedValue(
		times.map(([start, end], index) => ({ uid: String(index), start: inst(start), end: inst(end) }))
	);

	const intervals = await fetchBusyIntervals(workCal, window);
	expect(intervals.map(({ start, end }) => [start.toString(), end.toString()])).toEqual([
		['2026-03-31T23:30:00Z', '2026-04-01T00:30:00Z'],
		['2026-04-15T10:00:00Z', '2026-04-15T11:00:00Z'],
		['2026-04-30T23:30:00Z', '2026-05-01T00:30:00Z']
	]);
});

test('propagates a provider failure to the caller', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response('boom', { status: 500, statusText: 'Internal Server Error' })
	);
	await expect(fetchBusyIntervals(workCal, window, {})).rejects.toThrow(/500/);
});

test('a relative href is joined to the provider url', async () => {
	const provider = { ...workDav, url: 'https://cal.example.com/dav/' };
	const relative: ResolvedCalendar = {
		type: 'caldav',
		name: 'work',
		providerName: 'dav',
		provider,
		calendar: { href: 'calendars/jane/work/', sync: { refresh_every_minutes: 10 } }
	};
	const spy = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(new Response(twoEvents, { status: 207 }));

	await fetchBusyIntervals(relative, window);

	expect(String(spy.mock.calls[0][0])).toBe('https://cal.example.com/dav/calendars/jane/work/');
});

test('a nextcloud provider gets its dav prefix before the join', async () => {
	const provider = {
		type: 'nextcloud' as const,
		url: 'https://cloud.example.com',
		username: 'jane',
		password: 'secret',
		calendars: {}
	};
	const relative: ResolvedCalendar = {
		type: 'caldav',
		name: 'work',
		providerName: 'nc',
		provider,
		calendar: { href: 'calendars/jane/work/', sync: { refresh_every_minutes: 10 } }
	};
	const spy = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(new Response(twoEvents, { status: 207 }));

	await fetchBusyIntervals(relative, window);

	expect(String(spy.mock.calls[0][0])).toBe(
		'https://cloud.example.com/remote.php/dav/calendars/jane/work/'
	);
});

test('an absolute href is used as given', async () => {
	const spy = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(new Response(twoEvents, { status: 207 }));

	await fetchBusyIntervals(workCal, window, {});

	expect(String(spy.mock.calls[0][0])).toBe('https://cal.example.com/work/');
});
