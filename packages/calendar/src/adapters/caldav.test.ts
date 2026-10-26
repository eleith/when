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
import { parseExpandedCalDavEvents } from '../parse.js';

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
const normalizedIcs = remoteIcs.replaceAll('\r\n', '\n');
const defaultNamespaceReport = `<multistatus xmlns="DAV:"><response><href>/cal/1.ics</href><propstat>
	<prop><calendar-data xmlns="urn:ietf:params:xml:ns:caldav">${remoteIcs}</calendar-data></prop>
	<status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;

test.each([' ', '\t', '\r', '\n'])(
	'readCalDavReport accepts XML declaration whitespace %j around equals signs',
	(whitespace) => {
		const declaration = `<?xml version${whitespace}=${whitespace}"1.0" encoding${whitespace}=${whitespace}'UTF-8' standalone${whitespace}=${whitespace}"yes"?>`;
		const xml = multistatus(resource(remoteIcs)).replace('<?xml version="1.0"?>', declaration);
		expect(readCalDavReport(xml)).toEqual([normalizedIcs]);
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
	const literal =
		'SUMMARY:&amp; &#13; <!DOCTYPE ignored> </c:calendar-data><d:response>not XML</d:response>';
	const data = `<![CDATA[${literal}]]>&amp;<![CDATA[&lt;]]>`;
	expect(readCalDavReport(multistatus(resource(data)))).toEqual([`${literal}&&lt;`]);
	// A CDATA section is not a resource, even when it contains a complete response.
	expect(() => readCalDavReport(multistatus(`<![CDATA[${resource('fake')}]]>`))).toThrow(
		/CalDAV XML/
	);
});

test.each([
	['CRLF', remoteIcs],
	['CR', remoteIcs.replaceAll('\r\n', '\r')],
	['CDATA CRLF', `<![CDATA[${remoteIcs}]]>`]
])('normalizes literal XML %s newlines without changing busy intervals', (_name, source) => {
	const blobs = readCalDavReport(multistatus(resource(source)));
	expect(blobs).toEqual([normalizedIcs]);
	const busy = blobs.flatMap(parseExpandedCalDavEvents);
	expect(busy.map((event) => [event.uid, event.start.toString(), event.end.toString()])).toEqual([
		['remote-1@x', '2026-04-15T14:00:00Z', '2026-04-15T15:00:00Z']
	]);
});

test('readCalDavReport preserves Unicode text rather than treating it as XML newlines', () => {
	const ics = remoteIcs.replace('SUMMARY:Remote', 'SUMMARY:one\u0085two\u2028three\u2029four �');
	const xml = multistatus(resource(ics.replaceAll('\r', '&#13;')));
	expect(readCalDavReport(xml)).toEqual([ics]);
});

test('readCalDavReport accepts default namespaces and genuine empty MultiStatus', () => {
	expect(readCalDavReport(defaultNamespaceReport)).toEqual([normalizedIcs]);
	expect(readCalDavReport(multistatus())).toEqual([]);
	expect(readCalDavReport('<multistatus xmlns="DAV:"/>')).toEqual([]);
});

test('readCalDavReport matches Unicode namespace prefixes by URI', () => {
	const xml = multistatus(resource(remoteIcs))
		.replaceAll('d:', 'é:')
		.replace('xmlns:d=', 'xmlns:é=');
	expect(readCalDavReport(xml)).toEqual([normalizedIcs]);
});

test('readCalDavReport uses the nearest namespace declaration without leaking sibling scopes', () => {
	const shadowed = multistatus(resource(remoteIcs)).replace(
		'<d:propstat>',
		'<d:propstat xmlns:c="urn:wrong">'
	);
	expect(() => readCalDavReport(shadowed)).toThrow(/calendar-data/);
	const restored = shadowed
		.replace('<c:calendar-data>', '<c:calendar-data xmlns:c="urn:ietf:params:xml:ns:caldav">')
		.replace(
			'</c:calendar-data>',
			'</c:calendar-data><c:calendar-data>unrequested namespace</c:calendar-data>'
		);
	expect(readCalDavReport(restored)).toEqual([normalizedIcs]);

	const reset = defaultNamespaceReport.replace('xmlns="urn:ietf:params:xml:ns:caldav"', 'xmlns=""');
	expect(() => readCalDavReport(reset)).toThrow(/calendar-data/);
});

test('readCalDavReport ignores processing instructions and comments without turning them into data', () => {
	const xml = multistatus(resource(remoteIcs))
		.replace('?><d:multistatus', '?><?provider hint="ignored"?><d:multistatus')
		.replace('UID:remote-1@x', 'UID:remote<?provider ignored?><!--ignored-->-1@x');
	expect(readCalDavReport(xml)).toEqual([normalizedIcs]);
});

test.each([
	['namespace defects', '<x:metadata xmlns:x="urn:test"><unbound:child/></x:metadata>'],
	[
		'nesting beyond the former 32-element ceiling',
		'<x:metadata xmlns:x="urn:test">' +
			'<x:child>'.repeat(64) +
			'<x:leaf/>' +
			'</x:child>'.repeat(64) +
			'</x:metadata>'
	]
])('readCalDavReport leaves %s in unrequested property content opaque', (_name, metadata) => {
	const xml = multistatus(resource(remoteIcs).replace('</d:prop>', `${metadata}</d:prop>`));
	expect(readCalDavReport(xml)).toEqual([normalizedIcs]);
});

test('readCalDavReport checks the original text ceiling before newline normalization', () => {
	const oversized = '\r\n'.repeat(MAX_CALDAV_REPORT_CODE_UNITS / 2) + '\n';
	expect(() => readCalDavReport(oversized)).toThrow(/exceeds .* UTF-16 code units/);
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
	['unknown root child', multistatus('<x:metadata xmlns:x="urn:test"/>')],
	['wrong root namespace', multistatus().replace('DAV:', 'urn:wrong')],
	[
		'unbound required field prefix',
		multistatus(resource(remoteIcs).replaceAll('d:href', 'unbound:href'))
	],
	[
		'malformed qualified root name',
		multistatus().replaceAll('d:multistatus', 'd:multistatus:extra')
	],
	['reserved namespace alias', '<xml:multistatus xmlns:xml="DAV:"/>'],
	[
		'duplicate href under another prefix',
		multistatus(
			resource(remoteIcs).replace(
				'</d:href>',
				'</d:href><other:href xmlns:other="DAV:">/other.ics</other:href>'
			)
		)
	],
	[
		'duplicate calendar-data',
		multistatus(
			resource(remoteIcs).replace('</d:prop>', '<c:calendar-data>other</c:calendar-data></d:prop>')
		)
	],
	['nested calendar-data markup', multistatus(resource(`<d:wrapper>${remoteIcs}</d:wrapper>`))],
	[
		'nested status markup',
		multistatus(
			resource(remoteIcs).replace('HTTP/1.1 200 OK', '<d:wrapper>HTTP/1.1 200 OK</d:wrapper>')
		)
	],
	['unsupported XML version', multistatus().replace('version="1.0"', 'version="1.1"')],
	['unknown entity', multistatus(resource('SUMMARY:&unknown;'))],
	['wrong-case entity', multistatus(resource('SUMMARY:&AMP;'))],
	['invalid numeric reference', multistatus(resource('SUMMARY:&#0;'))]
])('readCalDavReport rejects %s instead of claiming no busy events', (_name, xml) => {
	expect(() => readCalDavReport(xml)).toThrow(/CalDAV (?:REPORT|XML)/);
});

test.each([
	['internal', '<!DOCTYPE d:multistatus [<!ENTITY unused "value">]>'],
	['external', '<!DOCTYPE d:multistatus SYSTEM "https://example.invalid/not-loaded.dtd">']
])('readCalDavReport explicitly rejects an otherwise valid %s DTD', (_name, doctype) => {
	const xml = multistatus().replace('?>', `?>${doctype}`);
	expect(() => readCalDavReport(xml)).toThrow(/DTD is not supported/);
});

test('readCalDavReport replaces library errors without exposing source excerpts or causes', () => {
	const secret = 'PRIVATE-CALENDAR-MARKER';
	const xml = multistatus(resource(`SUMMARY:${secret}`)).replace(
		'</c:calendar-data>',
		'</c:wrong>'
	);
	let error: unknown;
	try {
		readCalDavReport(xml);
	} catch (caught) {
		error = caught;
	}
	expect(error).toBeInstanceOf(Error);
	expect(error).toHaveProperty('message', 'Invalid CalDAV XML: parsing failed');
	expect(error).not.toHaveProperty('cause');
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

test('discovery follows principal and home-set properties before listing calendar paths', async () => {
	const urls: string[] = [];
	mockPropfind(calDavXml('/dav'), urls);
	const calendars = await discoverCalDavCalendars(davService);
	expect(calendars).toEqual([
		{ displayName: 'Work', path: 'calendars/u/work/' },
		{ displayName: 'Personal', path: 'calendars/u/personal/' }
	]);
	expect(urls).toEqual([
		'https://host/dav/',
		'https://host/dav/principals/u/',
		'https://host/dav/calendars/u/'
	]);
	expect(
		vi.mocked(fetch).mock.calls.map(([, init]) => (init?.headers as Record<string, string>).Depth)
	).toEqual(['0', '0', '1']);
});

test.each([
	['numeric and named references', 'Work &#38; &amp;lt;', 'Work & &lt;'],
	[
		'CDATA with literal XML-looking text',
		'<![CDATA[Work &amp; <d:response>literal</d:response>]]>&amp;',
		'Work &amp; <d:response>literal</d:response>&'
	]
])('discovery decodes %s once in display names', async (_name, data, expected) => {
	const xml = calDavXml('/dav');
	xml.calendars = xml.calendars.replace('>Work<', `>${data}<`);
	mockPropfind(xml);
	const calendars = await discoverCalDavCalendars(davService);
	expect(calendars.map((calendar) => calendar.displayName)).toEqual([expected, 'Personal']);
});

test('discovery matches namespace URIs across all three PROPFIND responses', async () => {
	const xml = calDavXml('/dav');
	for (const key of ['principal', 'home', 'calendars'] as const) {
		xml[key] = xml[key].replaceAll('d:', 'é:').replaceAll('xmlns:d=', 'xmlns:é=');
	}
	xml.calendars = xml.calendars
		.replaceAll('cal:', 'calendar.ns:')
		.replace('xmlns:cal=', 'xmlns:calendar.ns=');
	const urls: string[] = [];
	mockPropfind(xml, urls);
	const calendars = await discoverCalDavCalendars(davService);
	expect(calendars).toEqual([
		{ displayName: 'Work', path: 'calendars/u/work/' },
		{ displayName: 'Personal', path: 'calendars/u/personal/' }
	]);
	expect(urls.slice(1)).toEqual([
		'https://host/dav/principals/u/',
		'https://host/dav/calendars/u/'
	]);
});

test('discovery ignores wrong-namespace calendars and nested href lookalikes', async () => {
	const xml = calDavXml('/dav');
	xml.calendars = xml.calendars
		.replace('<d:collection/>', '<d:collection/><x:calendar xmlns:x="urn:other"/>')
		.replace(
			'<d:href>/dav/calendars/u/work/</d:href>',
			'<x:metadata xmlns:x="urn:other"><d:href>/wrong/</d:href></x:metadata>' +
				'<d:href>/dav/calendars/u/work/</d:href>'
		);
	mockPropfind(xml);
	const calendars = await discoverCalDavCalendars(davService);
	expect(calendars).toEqual([
		{ displayName: 'Work', path: 'calendars/u/work/' },
		{ displayName: 'Personal', path: 'calendars/u/personal/' }
	]);
});

test('discovery XML-decodes hrefs without percent-decoding or changing URL resolution', async () => {
	const xml = calDavXml('/dav');
	xml.principal = xml.principal.replace(
		'/dav/principals/u/',
		'/dav/principals/first%2Flast/?a=1&amp;b=2'
	);
	xml.home = xml.home.replace('/dav/calendars/u/', 'calendars/u/');
	xml.calendars = xml.calendars.replace(
		'/dav/calendars/u/personal/',
		'https://other.example/shared%2Fview/?a=1&amp;b=2'
	);
	const urls: string[] = [];
	mockPropfind(xml, urls);
	const calendars = await discoverCalDavCalendars(davService);
	expect(urls).toEqual([
		'https://host/dav/',
		'https://host/dav/principals/first%2Flast/?a=1&b=2',
		'https://host/dav/calendars/u/'
	]);
	expect(calendars[1]).toEqual({
		displayName: 'Personal',
		path: 'https://other.example/shared%2Fview/?a=1&b=2'
	});
});

test('discovery retains base-URL fallbacks when principal and home properties are absent', async () => {
	const xml = calDavXml('/dav');
	xml.principal = '<multistatus xmlns="DAV:"/>';
	xml.home = '<multistatus xmlns="DAV:"/>';
	const urls: string[] = [];
	mockPropfind(xml, urls);
	const calendars = await discoverCalDavCalendars(davService);
	expect(urls).toEqual(['https://host/dav/', 'https://host/dav/', 'https://host/dav/']);
	expect(calendars).toHaveLength(2);
});

test('discovery keeps unnamed calendars but skips resources missing their href', async () => {
	const xml = calDavXml('/dav');
	xml.calendars = xml.calendars
		.replace('<d:displayname>Work</d:displayname>', '<d:displayname/>')
		.replace('<d:href>/dav/calendars/u/personal/</d:href>', '');
	mockPropfind(xml);
	const calendars = await discoverCalDavCalendars(davService);
	expect(calendars).toEqual([{ displayName: '(unnamed)', path: 'calendars/u/work/' }]);
});

test('discovery rejects truncated XML rather than returning a partial calendar list', async () => {
	const xml = calDavXml('/dav');
	xml.calendars = xml.calendars.replace('</d:multistatus>', '<unclosed>');
	mockPropfind(xml);
	await expect(discoverCalDavCalendars(davService)).rejects.toThrow(/CalDAV XML/);
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
