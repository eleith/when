import type { Temporal } from '@js-temporal/polyfill';
import { logger } from '../logger';
import { parseBusyEvents } from './parse';
import type { BusyEvent } from './types';

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
	const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
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
