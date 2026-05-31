import { beforeEach, describe, expect, test } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import type { FetchFn } from '$lib/server/calendar/adapters/caldav';
import {
	clearConflictCache,
	conflictPullWindow,
	pullConflictBusy
} from '$lib/server/calendar/conflicts';
import type { Calendar } from '$lib/server/config/schema';

const inst = (s: string): Temporal.Instant => Temporal.Instant.from(s);

const window = {
	start: inst('2026-04-01T00:00:00Z'),
	end: inst('2026-05-01T00:00:00Z')
};

const sampleVevent = `<?xml version="1.0"?>
<multistatus xmlns:C="urn:ietf:params:xml:ns:caldav">
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
</multistatus>`;

const calendars: Calendar[] = [
	{
		id: 'work',
		type: 'caldav',
		url: 'https://cal.example.com/work/',
		username: 'jane',
		password: 'secret'
	},
	{
		id: 'g',
		type: 'google',
		client_id: 'gid',
		client_secret: 'gsec',
		refresh_token: 'gtoken-conflict',
		google_calendar_id: 'gcal'
	}
];

beforeEach(() => clearConflictCache());

test('pulls a single CalDAV calendar and returns intervals', async () => {
	const fakeFetch: FetchFn = async () => new Response(sampleVevent, { status: 207 });
	const intervals = await pullConflictBusy(calendars, ['work'], window, {
		fetchImpl: fakeFetch,
		now: 1_000
	});
	expect(intervals).toHaveLength(1);
	expect(intervals[0].start.toString()).toBe('2026-04-15T14:00:00Z');
});

test('pulls a Google calendar and returns intervals', async () => {
	let reqCount = 0;
	const fakeFetch: FetchFn = async (input) => {
		reqCount++;
		const url = input.toString();
		if (url.includes('oauth2')) {
			return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
				status: 200
			});
		} else if (url.includes('events')) {
			return new Response(
				JSON.stringify({
					items: [
						{
							id: 'g1',
							start: { dateTime: '2026-04-15T12:00:00Z' },
							end: { dateTime: '2026-04-15T13:00:00Z' }
						}
					]
				}),
				{ status: 200 }
			);
		}
		return new Response('Not found', { status: 404 });
	};

	const intervals = await pullConflictBusy(calendars, ['g'], window, {
		fetchImpl: fakeFetch,
		now: 1_000
	});

	expect(reqCount).toBe(2);
	expect(intervals).toEqual([
		{
			start: Temporal.Instant.from('2026-04-15T12:00:00Z'),
			end: Temporal.Instant.from('2026-04-15T13:00:00Z')
		}
	]);
});

test('pulls mixed CalDAV and Google calendars together', async () => {
	const fakeFetch: FetchFn = async (input) => {
		const url = input.toString();
		if (url.includes('cal.example.com')) {
			return new Response(sampleVevent, { status: 207 });
		}
		if (url.includes('oauth2')) {
			return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
				status: 200
			});
		} else if (url.includes('events')) {
			return new Response(
				JSON.stringify({
					items: [
						{
							id: 'g1',
							start: { dateTime: '2026-04-16T12:00:00Z' },
							end: { dateTime: '2026-04-16T13:00:00Z' }
						}
					]
				}),
				{ status: 200 }
			);
		}
		return new Response('Not found', { status: 404 });
	};

	const intervals = await pullConflictBusy(calendars, ['work', 'g'], window, {
		fetchImpl: fakeFetch,
		now: 1_000
	});

	expect(intervals).toHaveLength(2);
});

test('caches results within 60s and re-fetches after TTL', async () => {
	let calls = 0;
	const fakeFetch: FetchFn = async () => {
		calls++;
		return new Response(sampleVevent, { status: 207 });
	};
	await pullConflictBusy(calendars, ['work'], window, { fetchImpl: fakeFetch, now: 1_000 });
	await pullConflictBusy(calendars, ['work'], window, { fetchImpl: fakeFetch, now: 30_000 });
	expect(calls).toBe(1);
	await pullConflictBusy(calendars, ['work'], window, {
		fetchImpl: fakeFetch,
		now: 1_000 + 61_000
	});
	expect(calls).toBe(2);
});

test('bypassCache forces a fresh fetch even within TTL', async () => {
	let calls = 0;
	const fakeFetch: FetchFn = async () => {
		calls++;
		return new Response(sampleVevent, { status: 207 });
	};
	await pullConflictBusy(calendars, ['work'], window, { fetchImpl: fakeFetch, now: 1_000 });
	await pullConflictBusy(calendars, ['work'], window, {
		fetchImpl: fakeFetch,
		now: 2_000,
		bypassCache: true
	});
	expect(calls).toBe(2);
});

test('failed CalDAV fetch yields empty and does not throw', async () => {
	const fakeFetch: FetchFn = async () =>
		new Response('boom', { status: 500, statusText: 'Internal Server Error' });
	const intervals = await pullConflictBusy(calendars, ['work'], window, {
		fetchImpl: fakeFetch,
		now: 1_000
	});
	expect(intervals).toEqual([]);
});

test('unknown calendar id is skipped', async () => {
	let calls = 0;
	const fakeFetch: FetchFn = async () => {
		calls++;
		return new Response(sampleVevent, { status: 207 });
	};
	const intervals = await pullConflictBusy(calendars, ['ghost'], window, {
		fetchImpl: fakeFetch,
		now: 1_000
	});
	expect(intervals).toEqual([]);
	expect(calls).toBe(0);
});

describe('conflictPullWindow', () => {
	test('window starts at now', () => {
		const now = inst('2026-04-15T10:00:00Z');
		const w = conflictPullWindow(now, 'UTC', 60);
		expect(w.start.toString()).toBe('2026-04-15T10:00:00Z');
	});

	test('window ends at first-of-next-month + 2 weeks when lookahead is large', () => {
		const now = inst('2026-04-15T10:00:00Z');
		const w = conflictPullWindow(now, 'UTC', 365);
		expect(w.end.toString()).toBe('2026-05-15T00:00:00Z');
	});

	test('window is capped at now + maxLookahead when shorter than the month-end + 2w', () => {
		const now = inst('2026-04-15T10:00:00Z');
		const w = conflictPullWindow(now, 'UTC', 7);
		expect(w.end.toString()).toBe('2026-04-22T10:00:00Z');
	});

	test('handles end of month correctly (Apr 30 → May 15)', () => {
		const now = inst('2026-04-30T23:00:00Z');
		const w = conflictPullWindow(now, 'UTC', 365);
		expect(w.end.toString()).toBe('2026-05-15T00:00:00Z');
	});

	test('handles year boundary (Dec → Jan + 2w)', () => {
		const now = inst('2026-12-15T10:00:00Z');
		const w = conflictPullWindow(now, 'UTC', 365);
		expect(w.end.toString()).toBe('2027-01-15T00:00:00Z');
	});

	test('respects user_tz when computing month end', () => {
		// Apr 30 23:00 UTC is May 1 in Asia/Tokyo (+09:00); the visible month
		// is May, so the cap should be Jun 15 in Tokyo midnight (= Jun 14 15:00 UTC).
		const now = inst('2026-04-30T23:00:00Z');
		const w = conflictPullWindow(now, 'Asia/Tokyo', 365);
		expect(w.end.toString()).toBe('2026-06-14T15:00:00Z');
	});
});
