import { expect, test } from 'bun:test';
import { Temporal } from '@js-temporal/polyfill';
import {
	buildReportBody,
	extractCalendarData,
	fetchCalDavBusy,
	type FetchFn
} from '../src/lib/server/calendar/caldav';

const inst = (s: string): Temporal.Instant => Temporal.Instant.from(s);

test('buildReportBody emits CalDAV time-range in basic ISO format', () => {
	const body = buildReportBody(inst('2026-04-01T00:00:00Z'), inst('2026-05-01T00:00:00Z'));
	expect(body).toContain('start="20260401T000000Z"');
	expect(body).toContain('end="20260501T000000Z"');
	expect(body).toContain('<C:comp-filter name="VEVENT">');
});

test('buildReportBody strips fractional seconds', () => {
	const body = buildReportBody(inst('2026-04-01T00:00:00.123Z'), inst('2026-05-01T00:00:00Z'));
	expect(body).toContain('start="20260401T000000Z"');
});

test('extractCalendarData picks up prefixed calendar-data blocks', () => {
	const xml = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/cal/1.ics</D:href>
    <D:propstat>
      <D:prop>
        <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//x//EN
BEGIN:VEVENT
UID:1@x
DTSTAMP:20260101T000000Z
DTSTART:20260415T140000Z
DTEND:20260415T150000Z
SUMMARY:A
END:VEVENT
END:VCALENDAR</C:calendar-data>
      </D:prop>
    </D:propstat>
  </D:response>
</D:multistatus>`;
	const blobs = extractCalendarData(xml);
	expect(blobs).toHaveLength(1);
	expect(blobs[0]).toContain('UID:1@x');
});

test('extractCalendarData picks up unprefixed calendar-data blocks', () => {
	const xml = `<multistatus>
  <response>
    <calendar-data>BEGIN:VCALENDAR
END:VCALENDAR</calendar-data>
  </response>
</multistatus>`;
	const blobs = extractCalendarData(xml);
	expect(blobs).toHaveLength(1);
	expect(blobs[0]).toBe('BEGIN:VCALENDAR\nEND:VCALENDAR');
});

test('extractCalendarData decodes XML entities inside the iCal block', () => {
	const xml = `<C:calendar-data>SUMMARY:Tea &amp; biscuits</C:calendar-data>`;
	expect(extractCalendarData(xml)).toEqual(['SUMMARY:Tea & biscuits']);
});

test('extractCalendarData returns empty array when no calendar-data', () => {
	expect(extractCalendarData('<multistatus></multistatus>')).toEqual([]);
});

test('fetchCalDavBusy sends a REPORT request with basic auth', async () => {
	let captured: { url: string; init: RequestInit } | null = null;
	const fakeFetch: FetchFn = async (url, init) => {
		captured = { url: String(url), init: init as RequestInit };
		return new Response(
			`<multistatus xmlns:C="urn:ietf:params:xml:ns:caldav">
				<response>
					<C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//x//EN
BEGIN:VEVENT
UID:remote-1@x
DTSTAMP:20260101T000000Z
DTSTART:20260415T140000Z
DTEND:20260415T150000Z
SUMMARY:Remote
END:VEVENT
END:VCALENDAR</C:calendar-data>
				</response>
			</multistatus>`,
			{ status: 207 }
		);
	};

	const events = await fetchCalDavBusy(
		{ url: 'https://cal.example.com/cal/', username: 'jane', password: 'secret' },
		{ start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') },
		fakeFetch
	);

	expect(events).toHaveLength(1);
	expect(events[0].uid).toBe('remote-1@x');
	expect(captured).not.toBeNull();
	const init = captured!.init;
	expect(init.method).toBe('REPORT');
	const headers = init.headers as Record<string, string>;
	expect(headers['Depth']).toBe('1');
	expect(headers['Content-Type']).toContain('application/xml');
	const expectedAuth = 'Basic ' + Buffer.from('jane:secret').toString('base64');
	expect(headers['Authorization']).toBe(expectedAuth);
});

test('fetchCalDavBusy throws on non-2xx response', async () => {
	const fakeFetch: FetchFn = async () =>
		new Response('forbidden', { status: 403, statusText: 'Forbidden' });
	await expect(
		fetchCalDavBusy(
			{ url: 'https://cal.example.com/cal/', username: 'a', password: 'b' },
			{ start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') },
			fakeFetch
		)
	).rejects.toThrow(/403/);
});
