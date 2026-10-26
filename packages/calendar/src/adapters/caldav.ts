import { logger } from '../logger.js';
import { parseExpandedCalDavEvents } from '../parse.js';
import type { BusyEvent, BusyWindow } from '../types.js';
import type { CalendarAdapter, PushOptions, PushResult, DeleteResult } from '../adapter.js';
import type {
	WhenConfiguration,
	CalDavCalendar,
	CalDavProvider,
	NextcloudProvider
} from '@when/config';
import { originId, type Appointment } from '@when/db';
import { buildIcs } from '../ics.js';
import { readCalDavReport, decodeXmlEntities } from './caldav-report.js';

export { readCalDavReport } from './caldav-report.js';

export interface CalDavConfig {
	url: string;
	username: string;
	password: string;
}

export interface FetchBusyOptions {
	start: Temporal.Instant;
	end: Temporal.Instant;
}

function davFetch(
	url: string,
	auth: { username: string; password: string },
	init: RequestInit
): Promise<Response> {
	return fetch(url, {
		...init,
		headers: {
			...init.headers,
			Authorization: `Basic ${btoa(`${auth.username}:${auth.password}`)}`
		}
	});
}

/**
 * Run a CalDAV REPORT calendar-query against the given calendar URL,
 * asking the server for concrete occurrences intersecting [start, end).
 * Reject failed or unexpanded responses before they can replace the busy mirror.
 */
export async function fetchCalDavBusy(
	cfg: CalDavConfig,
	opts: FetchBusyOptions
): Promise<BusyEvent[]> {
	const body = buildReportBody(opts.start, opts.end);
	const res = await davFetch(cfg.url, cfg, {
		method: 'REPORT',
		headers: { 'Content-Type': 'application/xml; charset=utf-8', Depth: '1' },
		body
	});
	if (!res.ok) {
		throw new Error(`CalDAV REPORT ${cfg.url} failed: ${res.status} ${res.statusText}`);
	}
	const xml = await res.text();
	const blobs = readCalDavReport(xml);
	const out: BusyEvent[] = [];
	for (const ics of blobs) {
		out.push(...parseExpandedCalDavEvents(ics));
	}
	logger.debug({ url: cfg.url, count: out.length }, 'fetched CalDAV busy events');
	return out;
}

/**
 * Create or replace a VEVENT at `${cfg.url}${uid}.ics` via HTTP PUT.
 * Pass an `etag` to enforce conditional update (If-Match); pass `null`
 * (default) for unconditional create-or-replace.
 */
export async function putCalDavEvent(
	cfg: CalDavConfig,
	uid: string,
	ics: string,
	opts: { etag?: string | null } = {}
): Promise<{ url: string; etag: string | null }> {
	const url = joinPath(cfg.url, `${encodeURIComponent(uid)}.ics`);
	const headers: Record<string, string> = { 'Content-Type': 'text/calendar; charset=utf-8' };
	if (opts.etag) headers['If-Match'] = opts.etag;
	const res = await davFetch(url, cfg, { method: 'PUT', headers, body: ics });
	if (!res.ok) {
		throw new Error(`CalDAV PUT ${url} failed: ${res.status} ${res.statusText}`);
	}
	return { url, etag: res.headers.get('etag') };
}

/**
 * Delete a VEVENT previously stored at `${cfg.url}${uid}.ics`.
 */
export async function deleteCalDavEvent(
	cfg: CalDavConfig,
	uid: string,
	opts: { etag?: string | null } = {}
): Promise<void> {
	const url = joinPath(cfg.url, `${encodeURIComponent(uid)}.ics`);
	const headers: Record<string, string> = {};
	if (opts.etag) headers['If-Match'] = opts.etag;
	const res = await davFetch(url, cfg, { method: 'DELETE', headers });
	// 404 means the event is already gone; treat as success.
	if (!res.ok && res.status !== 404) {
		throw new Error(`CalDAV DELETE ${url} failed: ${res.status} ${res.statusText}`);
	}
}

function joinPath(base: string, child: string): string {
	return base.endsWith('/') ? base + child : base + '/' + child;
}

// Pin DATE/floating selection to the same UTC interpretation used by the importer.
// Otherwise the server's calendar timezone can omit occurrences before we see them.
const QUERY_TIMEZONE = [
	'BEGIN:VCALENDAR',
	'VERSION:2.0',
	'PRODID:-//When//CalDAV Query//EN',
	'BEGIN:VTIMEZONE',
	'TZID:UTC',
	'BEGIN:STANDARD',
	'DTSTART:19700101T000000',
	'TZOFFSETFROM:+0000',
	'TZOFFSETTO:+0000',
	'END:STANDARD',
	'END:VTIMEZONE',
	'END:VCALENDAR'
].join('\r\n');

export function buildReportBody(start: Temporal.Instant, end: Temporal.Instant): string {
	return `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-data>
      <C:expand start="${formatCalDavInstant(start)}" end="${formatCalDavInstant(end)}" />
    </C:calendar-data>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${formatCalDavInstant(start)}" end="${formatCalDavInstant(end)}" />
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
  <C:timezone>${QUERY_TIMEZONE}</C:timezone>
</C:calendar-query>`;
}

function formatCalDavInstant(i: Temporal.Instant): string {
	return i.toString().replace(/\.\d+/, '').replace(/[-:]/g, '');
}

export class CalDavAdapter implements CalendarAdapter {
	private name: string;
	private cal: CalDavCalendar;
	private service: CalDavProvider | NextcloudProvider;

	constructor(name: string, cal: CalDavCalendar, service: CalDavProvider | NextcloudProvider) {
		this.name = name;
		this.cal = cal;
		this.service = service;
	}

	private get adapterCfg(): CalDavConfig {
		const calUrl = URL.canParse(this.cal.href)
			? this.cal.href
			: `${davBaseUrl(this.service)}${this.cal.href.replace(/^\//, '')}`;
		return {
			url: calUrl,
			username: this.service.username,
			password: this.service.password
		};
	}

	async fetchBusy(window: BusyWindow) {
		return fetchCalDavBusy(this.adapterCfg, { start: window.start, end: window.end });
	}

	async pushAppointment(
		cfg: WhenConfiguration,
		appointment: Appointment,
		eventTypeName: string,
		opts: PushOptions
	): Promise<PushResult> {
		const ics = buildIcs({
			appointment,
			eventTypeName,
			hostName: cfg.user.name,
			hostEmail: cfg.user.email,
			cancelUrl: opts.cancelUrl
			// No method — CalDAV calendar object resources must not have METHOD.
			// (Nextcloud and other servers reject such PUTs with 415.)
		});

		const uid = originId(appointment);
		await putCalDavEvent(this.adapterCfg, uid, ics);
		return { ok: true, externalEventId: uid, externalCalendarId: this.name };
	}

	async deleteAppointment(externalEventId: string): Promise<DeleteResult> {
		await deleteCalDavEvent(this.adapterCfg, externalEventId);
		return { ok: true };
	}
}

export interface CalDavCalendarItem {
	displayName: string;
	path: string;
}

type CalDavProviderCreds = CalDavProvider | NextcloudProvider;

const PRINCIPAL_BODY =
	'<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
const HOME_BODY =
	'<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>';
const CALENDARS_BODY =
	'<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>';

export async function verifyCalDavProvider(service: CalDavProviderCreds): Promise<void> {
	await davPropfind(davBaseUrl(service), service, PRINCIPAL_BODY, '0');
}

export async function discoverCalDavCalendars(
	service: CalDavProviderCreds
): Promise<CalDavCalendarItem[]> {
	const base = davBaseUrl(service);
	const principal = firstHref(
		innerXml(await davPropfind(base, service, PRINCIPAL_BODY, '0'), 'current-user-principal')
	);
	const home = firstHref(
		innerXml(
			await davPropfind(new URL(principal ?? '', base).toString(), service, HOME_BODY, '0'),
			'calendar-home-set'
		)
	);
	const xml = await davPropfind(new URL(home ?? '', base).toString(), service, CALENDARS_BODY, '1');
	return parseCalendars(xml, base);
}

function davBaseUrl(service: CalDavProviderCreds): string {
	const base = service.url.replace(/\/$/, '');
	const withDav = service.type === 'nextcloud' ? `${base}/remote.php/dav` : base;
	return `${withDav}/`;
}

async function davPropfind(
	url: string,
	service: CalDavProviderCreds,
	body: string,
	depth: string
): Promise<string> {
	const res = await davFetch(url, service, {
		method: 'PROPFIND',
		headers: { Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' },
		body
	});
	if (res.status === 401) throw new Error('bad credentials (401)');
	if (!res.ok) throw new Error(`CalDAV PROPFIND ${url} failed: ${res.status} ${res.statusText}`);
	return res.text();
}

function parseCalendars(xml: string, baseUrl: string): CalDavCalendarItem[] {
	const responses = [...xml.matchAll(/<[a-z0-9]*:?response[\s>][\s\S]*?<\/[a-z0-9]*:?response>/gi)];
	const items: CalDavCalendarItem[] = [];
	for (const [block] of responses) {
		const resourcetype = innerXml(block, 'resourcetype') ?? '';
		if (!/<[a-z0-9]*:?calendar[\s/>]/i.test(resourcetype)) continue;
		const href = firstHref(block);
		if (!href) continue;
		const displayName =
			decodeXmlEntities(innerXml(block, 'displayname') ?? '').trim() || '(unnamed)';
		items.push({ displayName, path: relativePath(href, baseUrl) });
	}
	return items;
}

function innerXml(xml: string | null, localName: string): string | null {
	if (!xml) return null;
	const match = xml.match(
		new RegExp(`<[a-z0-9]*:?${localName}[^>]*>([\\s\\S]*?)</[a-z0-9]*:?${localName}>`, 'i')
	);
	return match ? match[1] : null;
}

function firstHref(xml: string | null): string | null {
	if (!xml) return null;
	const match = xml.match(/<[a-z0-9]*:?href[^>]*>\s*([^<\s][\s\S]*?)\s*<\//i);
	return match ? match[1] : null;
}

function relativePath(href: string, baseUrl: string): string {
	const abs = new URL(href, baseUrl);
	const base = new URL(baseUrl);
	if (abs.origin === base.origin && abs.pathname.startsWith(base.pathname)) {
		return abs.pathname.slice(base.pathname.length);
	}
	return abs.toString();
}
