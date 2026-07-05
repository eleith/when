import { expect, test } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import type { Calendar, WhenConfiguration } from '@when/config';
import type { FetchFn } from './adapter.js';
import { fetchBusyIntervals } from './busy.js';

const inst = (s: string): Temporal.Instant => Temporal.Instant.from(s);
const window = { start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') };

const workCal: Calendar = {
	id: 'work',
	type: 'caldav',
	service_id: 'work-dav',
	url: 'https://cal.example.com/work/'
};

const fakeConfig = {
	services: [
		{
			id: 'work-dav',
			type: 'caldav',
			url: 'https://cal.example.com/work/',
			username: 'jane',
			password: 'secret'
		}
	]
} as unknown as WhenConfiguration;

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

test('returns all intervals when nothing is excluded', async () => {
	const fakeFetch: FetchFn = async () => new Response(twoEvents, { status: 207 });
	const intervals = await fetchBusyIntervals(workCal, window, {
		config: fakeConfig,
		fetchImpl: fakeFetch
	});
	expect(intervals).toHaveLength(2);
});

test('drops our own event by uid but keeps a genuine event at the same time', async () => {
	const fakeFetch: FetchFn = async () => new Response(twoEvents, { status: 207 });
	const intervals = await fetchBusyIntervals(workCal, window, {
		config: fakeConfig,
		fetchImpl: fakeFetch,
		excludeUids: new Set(['our-appt-1'])
	});
	expect(intervals).toHaveLength(1);
	expect(intervals[0].start.toString()).toBe('2026-04-15T14:00:00Z');
});

test('propagates a provider failure to the caller', async () => {
	const fakeFetch: FetchFn = async () =>
		new Response('boom', { status: 500, statusText: 'Internal Server Error' });
	await expect(
		fetchBusyIntervals(workCal, window, { config: fakeConfig, fetchImpl: fakeFetch })
	).rejects.toThrow(/500/);
});
