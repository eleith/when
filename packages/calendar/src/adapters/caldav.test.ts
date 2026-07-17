import { expect, test, vi, beforeEach } from 'vitest';
import {
	buildReportBody,
	extractCalendarData,
	fetchCalDavBusy,
	verifyCalDavService,
	discoverCalDavCalendars
} from './caldav.js';
import type { CalDavService, NextcloudService } from '@when/config';

const inst = (s: string): Temporal.Instant => Temporal.Instant.from(s);

beforeEach(() => {
	vi.restoreAllMocks();
});

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
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
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
	});

	const events = await fetchCalDavBusy(
		{ url: 'https://cal.example.com/cal/', username: 'jane', password: 'secret' },
		{ start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') }
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
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response('forbidden', { status: 403, statusText: 'Forbidden' })
	);
	await expect(
		fetchCalDavBusy(
			{ url: 'https://cal.example.com/cal/', username: 'a', password: 'b' },
			{ start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') }
		)
	).rejects.toThrow(/403/);
});

const davService = {
	name: 'dav',
	type: 'caldav',
	url: 'https://host/dav/',
	username: 'u',
	password: 'p'
} as CalDavService;

const calDavXml = (prefix: string) => ({
	principal: `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${prefix}/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>${prefix}/principals/u/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>`,
	home: `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${prefix}/principals/u/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>${prefix}/calendars/u/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response></d:multistatus>`,
	calendars: `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
<d:response><d:href>${prefix}/calendars/u/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:displayname></d:displayname></d:prop></d:propstat></d:response>
<d:response><d:href>${prefix}/calendars/u/work/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>Work</d:displayname></d:prop></d:propstat></d:response>
<d:response><d:href>${prefix}/calendars/u/personal/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>Personal</d:displayname></d:prop></d:propstat></d:response>
</d:multistatus>`
});

function mockPropfind(
	xml: { principal: string; home: string; calendars: string },
	urls?: string[]
) {
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		urls?.push(String(url));
		const body = String(init?.body ?? '');
		if (body.includes('current-user-principal'))
			return new Response(xml.principal, { status: 207 });
		if (body.includes('calendar-home-set')) return new Response(xml.home, { status: 207 });
		return new Response(xml.calendars, { status: 207 });
	});
}

test('verifyCalDavService resolves on a 207 PROPFIND', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 207 }));
	await expect(verifyCalDavService(davService)).resolves.toBeUndefined();
});

test('verifyCalDavService throws bad credentials on 401', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));
	await expect(verifyCalDavService(davService)).rejects.toThrow(/401/);
});

test('discoverCalDavCalendars returns calendar paths relative to the base', async () => {
	mockPropfind(calDavXml('/dav'));
	expect(await discoverCalDavCalendars(davService)).toEqual([
		{ displayName: 'Work', path: 'calendars/u/work/' },
		{ displayName: 'Personal', path: 'calendars/u/personal/' }
	]);
});

test('discoverCalDavCalendars targets the Nextcloud dav base', async () => {
	const urls: string[] = [];
	mockPropfind(calDavXml('/remote.php/dav'), urls);
	const nc = {
		name: 'nc',
		type: 'nextcloud',
		url: 'https://cloud.example.com/',
		username: 'u',
		password: 'p'
	} as NextcloudService;
	const cals = await discoverCalDavCalendars(nc);
	expect(urls[0]).toBe('https://cloud.example.com/remote.php/dav/');
	expect(cals[0].path).toBe('calendars/u/work/');
});
