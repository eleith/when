import { expect, test, vi, beforeEach } from 'vitest';
import { convertIcsCalendar } from 'ts-ics';
import {
	buildReportBody,
	readCalDavReport,
	fetchCalDavBusy,
	verifyCalDavProvider,
	discoverCalDavCalendars
} from './caldav.js';
import type { CalDavProvider, NextcloudProvider } from '@when/config';
import { MAX_CALDAV_REPORT_CODE_UNITS } from './caldav-report.js';

const inst = (s: string): Temporal.Instant => Temporal.Instant.from(s);

beforeEach(() => {
	vi.restoreAllMocks();
});

test('requests server expansion and resource filtering for the same UTC window', () => {
	const body = buildReportBody(inst('2026-04-01T00:00:00Z'), inst('2026-05-01T00:00:00Z'));
	const range = 'start="20260401T000000Z" end="20260501T000000Z"';
	expect(body).toContain(`<C:expand ${range} />`);
	expect(body).toContain(`<C:time-range ${range} />`);
	expect(body).toContain('<C:comp-filter name="VEVENT">');
});

test('pins DATE and floating-time selection to UTC rather than the calendar timezone', () => {
	const body = buildReportBody(inst('2026-04-01T09:00:00Z'), inst('2026-04-02T09:00:00Z'));
	const timezone = body.match(/<C:timezone>([\s\S]*?)<\/C:timezone>/)?.[1];
	expect(timezone).toBeDefined();
	const calendar = convertIcsCalendar(undefined, timezone!);
	expect(calendar.timezones).toHaveLength(1);
	expect(calendar.timezones?.[0]).toMatchObject({
		id: 'UTC',
		props: [{ type: 'STANDARD', offsetFrom: '+0000', offsetTo: '+0000' }]
	});
});

test('buildReportBody strips fractional seconds', () => {
	const body = buildReportBody(inst('2026-04-01T00:00:00.123Z'), inst('2026-05-01T00:00:00Z'));
	expect(body).toContain('start="20260401T000000Z"');
});

const multistatus = (responses = '') =>
	`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${responses}</d:multistatus>`;
const resource = (data: string, status = '200 OK') =>
	`<d:response><d:href>/cal/1.ics</d:href><d:propstat><d:prop><c:calendar-data>${data}</c:calendar-data></d:prop><d:status>HTTP/1.1 ${status}</d:status></d:propstat></d:response>`;
const remoteIcs = [
	'BEGIN:VCALENDAR',
	'VERSION:2.0',
	'PRODID:-//x//EN',
	'BEGIN:VEVENT',
	'UID:remote-1@x',
	'DTSTAMP:20260101T000000Z',
	'DTSTART:20260415T140000Z',
	'DTEND:20260415T150000Z',
	'SUMMARY:Remote',
	'END:VEVENT',
	'END:VCALENDAR'
].join('\r\n');

test.each([' ', '\t', '\r', '\n'])(
	'readCalDavReport accepts XML declaration whitespace %j around equals signs',
	(whitespace) => {
		const declaration = `<?xml version${whitespace}=${whitespace}"1.0" encoding${whitespace}=${whitespace}'UTF-8' standalone${whitespace}=${whitespace}"yes"?>`;
		const xml = multistatus(resource(remoteIcs)).replace('<?xml version="1.0"?>', declaration);
		expect(readCalDavReport(xml)).toEqual([remoteIcs]);
	}
);

test('readCalDavReport decodes Nextcloud numeric CRs and entities exactly once', () => {
	const ics = remoteIcs.replace('SUMMARY:Remote', 'SUMMARY:Tea & biscuits < &amp; &#13;');
	const encoded = ics.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\r', '&#13;');
	expect(readCalDavReport(multistatus(resource(encoded)))).toEqual([ics]);
	expect(
		readCalDavReport(multistatus(resource('SUMMARY:&#x54;ea &quot;x&quot; &apos;y&apos; &gt;')))
	).toEqual([`SUMMARY:Tea "x" 'y' >`]);
});

test('readCalDavReport preserves literal entities and DAV-looking tags inside CDATA', () => {
	const literal = 'SUMMARY:&amp; &#13; </c:calendar-data><d:response>not XML</d:response>';
	const data = `<![CDATA[${literal}]]>&amp;<![CDATA[&lt;]]>`;
	expect(readCalDavReport(multistatus(resource(data)))).toEqual([`${literal}&&lt;`]);
	// A CDATA section is not a resource, even when it contains a complete response.
	expect(() => readCalDavReport(multistatus(`<![CDATA[${resource('fake')}]]>`))).toThrow(
		/CalDAV REPORT/
	);
});

test('readCalDavReport accepts default namespaces and genuine empty MultiStatus', () => {
	const xml = `<multistatus xmlns="DAV:"><response><href>/cal/1.ics</href><propstat>
		<prop><calendar-data xmlns="urn:ietf:params:xml:ns:caldav">${remoteIcs}</calendar-data></prop>
		<status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
	expect(readCalDavReport(xml)).toEqual([remoteIcs]);
	expect(readCalDavReport(multistatus())).toEqual([]);
	expect(readCalDavReport('<multistatus xmlns="DAV:"/>')).toEqual([]);
});

test('readCalDavReport retains the ceiling of 32 open non-self-closing elements', () => {
	const reportWithMetadata = (levels: number) => {
		// multistatus/response/propstat/prop account for the other four open elements.
		const metadata =
			'<x:metadata xmlns:x="urn:test">' +
			'<x:child>'.repeat(levels - 1) +
			'<x:leaf/>' +
			'</x:child>'.repeat(levels - 1) +
			'</x:metadata>';
		return multistatus(resource(remoteIcs).replace('</d:prop>', `${metadata}</d:prop>`));
	};
	expect(readCalDavReport(reportWithMetadata(28))).toEqual([remoteIcs]);
	expect(() => readCalDavReport(reportWithMetadata(29))).toThrow(
		/nesting exceeds 32 open elements/
	);
});

test.each([
	['non-XML body', 'upstream unavailable'],
	['non-MultiStatus XML', '<html><body>upstream unavailable</body></html>'],
	['truncated response', multistatus(resource(remoteIcs)).slice(0, -16)],
	['mismatched closing tag', multistatus(resource(remoteIcs)).replace('</d:prop>', '</d:wrong>')],
	[
		'missing calendar-data',
		multistatus(
			resource(remoteIcs).replace(
				/<c:calendar-data>[^]*?<\/c:calendar-data>/,
				'<d:getetag>etag</d:getetag>'
			)
		)
	],
	[
		'missing status',
		multistatus(resource(remoteIcs).replace('<d:status>HTTP/1.1 200 OK</d:status>', ''))
	],
	['DTD', '<!DOCTYPE multistatus [<!ENTITY x "value">]>' + multistatus()],
	['unknown entity', multistatus(resource('SUMMARY:&unknown;'))]
])('readCalDavReport rejects %s instead of claiming no busy events', (_name, xml) => {
	expect(() => readCalDavReport(xml)).toThrow(/CalDAV (?:REPORT|XML)/);
});

test.each([
	[
		'resource failure',
		'<d:response><d:href>/cal/failed.ics</d:href><d:status>HTTP/1.1 403 Forbidden</d:status></d:response>'
	],
	['calendar-data property failure', resource('', '404 Not Found')]
])('fetchCalDavBusy rejects a partial 207 with %s', async (_name, failed) => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(multistatus(resource(remoteIcs) + failed), { status: 207 })
	);
	await expect(
		fetchCalDavBusy(
			{ url: 'https://cal.example.com/cal/', username: 'a', password: 'b' },
			{ start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') }
		)
	).rejects.toThrow(/CalDAV REPORT.*(?:403|404)/);
});

test('fetchCalDavBusy rejects unexpanded series even when calendar-data reports success', async () => {
	const ics = remoteIcs.replace('SUMMARY:Remote', 'RRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:Remote');
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(multistatus(resource(ics)), { status: 207 })
	);
	await expect(
		fetchCalDavBusy(
			{ url: 'https://cal.example.com/cal/', username: 'a', password: 'b' },
			{ start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') }
		)
	).rejects.toThrow(/expanded occurrences/);
});

test('fetchCalDavBusy sends a REPORT request with basic auth', async () => {
	let captured: { url: string; init: RequestInit } | null = null;
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		captured = { url: String(url), init: init as RequestInit };
		// Nextcloud's expanded calendar-data uses numeric CR entities before literal LF.
		return new Response(multistatus(resource(remoteIcs.replaceAll('\r', '&#13;'))), {
			status: 207
		});
	});

	const events = await fetchCalDavBusy(
		{ url: 'https://cal.example.com/cal/', username: 'jane', password: 'secret' },
		{ start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') }
	);

	expect(events).toHaveLength(1);
	expect(events[0].uid).toBe('remote-1@x');
	expect(events[0].start.toString()).toBe('2026-04-15T14:00:00Z');
	expect(captured).not.toBeNull();
	const init = captured!.init;
	expect(init.method).toBe('REPORT');
	expect(init.body).toContain('<C:expand ');
	const headers = init.headers as Record<string, string>;
	expect(headers['Depth']).toBe('1');
	expect(headers['Content-Type']).toContain('application/xml');
	const expectedAuth = 'Basic ' + Buffer.from('jane:secret').toString('base64');
	expect(headers['Authorization']).toBe(expectedAuth);
});

test('fetchCalDavBusy cancels an oversized REPORT before reading it to completion', async () => {
	let reads = 0;
	const cancel = vi.fn();
	const response = new Response(
		new ReadableStream(
			{
				pull(controller) {
					if (reads++ === 0) {
						controller.enqueue(new Uint8Array(MAX_CALDAV_REPORT_CODE_UNITS + 1).fill(32));
					} else {
						controller.error(new Error('read past the REPORT size ceiling'));
					}
				},
				cancel
			},
			{ highWaterMark: 0 }
		),
		{ status: 207 }
	);
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
	await expect(
		fetchCalDavBusy(
			{ url: 'https://cal.example.com/cal/', username: 'a', password: 'b' },
			{ start: inst('2026-04-01T00:00:00Z'), end: inst('2026-05-01T00:00:00Z') }
		)
	).rejects.toThrow(/exceeds .* UTF-16 code units/);
	expect(reads).toBe(1);
	expect(cancel).toHaveBeenCalledOnce();
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
	type: 'caldav',
	url: 'https://host/dav/',
	username: 'u',
	password: 'p'
} as CalDavProvider;

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

test('verifyCalDavProvider resolves on a 207 PROPFIND', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 207 }));
	await expect(verifyCalDavProvider(davService)).resolves.toBeUndefined();
});

test('verifyCalDavProvider throws bad credentials on 401', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));
	await expect(verifyCalDavProvider(davService)).rejects.toThrow(/401/);
});

test('discoverCalDavCalendars returns calendar paths relative to the base', async () => {
	mockPropfind(calDavXml('/dav'));
	expect(await discoverCalDavCalendars(davService)).toEqual([
		{ displayName: 'Work', path: 'calendars/u/work/' },
		{ displayName: 'Personal', path: 'calendars/u/personal/' }
	]);
});

test('discovery display names also decode numeric and named entities once', async () => {
	const xml = calDavXml('/dav');
	xml.calendars = xml.calendars.replace('>Work<', '>Work &#38; &amp;lt;<');
	mockPropfind(xml);
	expect((await discoverCalDavCalendars(davService))[0].displayName).toBe('Work & &lt;');
});

test('discoverCalDavCalendars targets the Nextcloud dav base', async () => {
	const urls: string[] = [];
	mockPropfind(calDavXml('/remote.php/dav'), urls);
	const nc = {
		type: 'nextcloud',
		url: 'https://cloud.example.com/',
		username: 'u',
		password: 'p'
	} as NextcloudProvider;
	const cals = await discoverCalDavCalendars(nc);
	expect(urls[0]).toBe('https://cloud.example.com/remote.php/dav/');
	expect(cals[0].path).toBe('calendars/u/work/');
});
