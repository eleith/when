import { expect, test, vi, beforeEach } from 'vitest';
import type { ResolvedCalendar } from '@when/config';
import { fetchBusyIntervals } from './busy.js';
import type { ConnectedProvider } from './adapter.js';

const inst = (s: string): Temporal.Instant => Temporal.Instant.from(s);
const window = { start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') };

const workDav = {
	name: 'work-dav',
	type: 'caldav' as const,
	url: 'https://cal.example.com/work/',
	username: 'jane',
	password: 'secret',
	calendars: []
};

const workCal: ResolvedCalendar = {
	type: 'caldav',
	provider: workDav,
	calendar: {
		name: 'work',
		href: 'https://cal.example.com/work/',
		sync: { refresh_every_minutes: 10 }
	}
};

const davServices: ConnectedProvider[] = [workDav];

const twoEvents = `<?xml version="1.0"?>
<multistatus xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <C:calendar-data>BEGIN:VCALENDAR
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
DTEND:20260415T150000Z
SUMMARY:Other
END:VEVENT
END:VCALENDAR</C:calendar-data>
  </response>
</multistatus>`;

beforeEach(() => {
	vi.restoreAllMocks();
});

test('returns all intervals when nothing is excluded', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(twoEvents, { status: 207 }));
	const intervals = await fetchBusyIntervals(workCal, window, {
		services: davServices
	});
	expect(intervals).toHaveLength(2);
});

test('drops our own event by uid but keeps a genuine event at the same time', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(twoEvents, { status: 207 }));
	const intervals = await fetchBusyIntervals(workCal, window, {
		services: davServices,
		excludeUids: new Set(['our-appt-1'])
	});
	expect(intervals).toHaveLength(1);
	expect(intervals[0].start.toString()).toBe('2026-04-15T14:00:00Z');
});

test('propagates a provider failure to the caller', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response('boom', { status: 500, statusText: 'Internal Server Error' })
	);
	await expect(fetchBusyIntervals(workCal, window, { services: davServices })).rejects.toThrow(
		/500/
	);
});

test('a relative href is joined to the provider url', async () => {
	const provider = { ...workDav, url: 'https://cal.example.com/dav/' };
	const relative: ResolvedCalendar = {
		type: 'caldav',
		provider,
		calendar: { name: 'work', href: 'calendars/jane/work/', sync: { refresh_every_minutes: 10 } }
	};
	const spy = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(new Response(twoEvents, { status: 207 }));

	await fetchBusyIntervals(relative, window, { services: [provider] });

	expect(String(spy.mock.calls[0][0])).toBe('https://cal.example.com/dav/calendars/jane/work/');
});

test('a nextcloud provider gets its dav prefix before the join', async () => {
	const provider = {
		name: 'nc',
		type: 'nextcloud' as const,
		url: 'https://cloud.example.com',
		username: 'jane',
		password: 'secret',
		calendars: []
	};
	const relative: ResolvedCalendar = {
		type: 'caldav',
		provider,
		calendar: { name: 'work', href: 'calendars/jane/work/', sync: { refresh_every_minutes: 10 } }
	};
	const spy = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(new Response(twoEvents, { status: 207 }));

	await fetchBusyIntervals(relative, window, { services: [provider] });

	expect(String(spy.mock.calls[0][0])).toBe(
		'https://cloud.example.com/remote.php/dav/calendars/jane/work/'
	);
});

test('an absolute href is used as given', async () => {
	const spy = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(new Response(twoEvents, { status: 207 }));

	await fetchBusyIntervals(workCal, window, { services: davServices });

	expect(String(spy.mock.calls[0][0])).toBe('https://cal.example.com/work/');
});
