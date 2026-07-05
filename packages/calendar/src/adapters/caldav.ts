import type { Temporal } from '@js-temporal/polyfill';
import { logger } from '../logger.js';
import { parseBusyEvents } from '../parse.js';
import type { BusyEvent } from '../types.js';
import type { CalendarAdapter, PushOptions, PushResult, DeleteResult } from '../adapter.js';
import type { WhenConfiguration, CalDavCalendar, CalDavService } from '@when/config';
import { originId, type Appointment } from '@when/db';
import type { ExpandWindow } from '../expand.js';
import { buildIcs } from '../ics.js';

export interface CalDavConfig {
	url: string;
	username: string;
	password: string;
}

export interface FetchBusyOptions {
	start: Temporal.Instant;
	end: Temporal.Instant;
}

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Run a CalDAV REPORT calendar-query against the given calendar URL,
 * returning all VEVENTs that intersect [start, end). Recurring masters
 * are returned as-is; the caller is responsible for RRULE expansion.
 */
export async function fetchCalDavBusy(
	cfg: CalDavConfig,
	opts: FetchBusyOptions,
	fetchImpl: FetchFn = fetch
): Promise<BusyEvent[]> {
	const body = buildReportBody(opts.start, opts.end);
	const auth = btoa(`${cfg.username}:${cfg.password}`);
	const res = await fetchImpl(cfg.url, {
		method: 'REPORT',
		headers: {
			Authorization: `Basic ${auth}`,
			'Content-Type': 'application/xml; charset=utf-8',
			Depth: '1'
		},
		body
	});
	if (!res.ok) {
		throw new Error(`CalDAV REPORT ${cfg.url} failed: ${res.status} ${res.statusText}`);
	}
	const xml = await res.text();
	const blobs = extractCalendarData(xml);
	const out: BusyEvent[] = [];
	for (const ics of blobs) {
		out.push(...parseBusyEvents(ics));
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
	opts: { etag?: string | null; fetchImpl?: FetchFn } = {}
): Promise<{ url: string; etag: string | null }> {
	const auth = btoa(`${cfg.username}:${cfg.password}`);
	const url = joinPath(cfg.url, `${encodeURIComponent(uid)}.ics`);
	const headers: Record<string, string> = {
		Authorization: `Basic ${auth}`,
		'Content-Type': 'text/calendar; charset=utf-8'
	};
	if (opts.etag) headers['If-Match'] = opts.etag;
	const fetchImpl = opts.fetchImpl ?? fetch;
	const res = await fetchImpl(url, { method: 'PUT', headers, body: ics });
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
	opts: { etag?: string | null; fetchImpl?: FetchFn } = {}
): Promise<void> {
	const auth = btoa(`${cfg.username}:${cfg.password}`);
	const url = joinPath(cfg.url, `${encodeURIComponent(uid)}.ics`);
	const headers: Record<string, string> = { Authorization: `Basic ${auth}` };
	if (opts.etag) headers['If-Match'] = opts.etag;
	const fetchImpl = opts.fetchImpl ?? fetch;
	const res = await fetchImpl(url, { method: 'DELETE', headers });
	// 404 means the event is already gone; treat as success.
	if (!res.ok && res.status !== 404) {
		throw new Error(`CalDAV DELETE ${url} failed: ${res.status} ${res.statusText}`);
	}
}

function joinPath(base: string, child: string): string {
	return base.endsWith('/') ? base + child : base + '/' + child;
}

export function buildReportBody(start: Temporal.Instant, end: Temporal.Instant): string {
	return `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-data />
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${formatCalDavInstant(start)}" end="${formatCalDavInstant(end)}" />
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
}

export function extractCalendarData(xml: string): string[] {
	// CalDAV XML responses are structurally predictable; regex extraction
	// avoids pulling in a full XML parser for this single-purpose operation.
	const re = /<[A-Za-z0-9]*:?calendar-data[^>]*>([\s\S]*?)<\/[A-Za-z0-9]*:?calendar-data>/g;
	const out: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml))) {
		out.push(decodeXmlEntities(m[1]).trim());
	}
	return out;
}

function formatCalDavInstant(i: Temporal.Instant): string {
	return i.toString().replace(/\.\d+/, '').replace(/[-:]/g, '');
}

function decodeXmlEntities(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

export class CalDavAdapter implements CalendarAdapter {
	constructor(
		private cal: CalDavCalendar,
		private service?: CalDavService
	) {}

	private get adapterCfg(): CalDavConfig {
		if (!this.service) {
			throw new Error(
				`Credentials service "${this.cal.service_id}" was not provided to CalDavAdapter`
			);
		}
		return {
			url: this.cal.url,
			username: this.service.username,
			password: this.service.password
		};
	}

	async fetchBusy(window: ExpandWindow, opts?: { fetchImpl?: FetchFn }) {
		return fetchCalDavBusy(
			this.adapterCfg,
			{ start: window.start, end: window.end },
			opts?.fetchImpl
		);
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
		await putCalDavEvent(this.adapterCfg, uid, ics, { fetchImpl: opts.fetchImpl });
		return { ok: true, externalEventId: uid, externalCalendarId: this.cal.id };
	}

	async deleteAppointment(
		externalEventId: string,
		opts?: { fetchImpl?: FetchFn }
	): Promise<DeleteResult> {
		await deleteCalDavEvent(this.adapterCfg, externalEventId, { fetchImpl: opts?.fetchImpl });
		return { ok: true };
	}
}
