import { describe, expect, test, vi, beforeEach } from 'vitest';
import {
	getGoogleAccessToken,
	fetchGoogleBusy,
	buildGoogleAuthUrl,
	exchangeGoogleAuthCode,
	revokeGoogleToken,
	listGoogleCalendars,
	putGoogleEvent,
	deleteGoogleEvent,
	type GoogleConfig
} from './google.js';
import type { Appointment } from '@when/db';

const cfg: GoogleConfig = {
	client_id: 'i',
	client_secret: 's',
	refresh_token: 'r',
	google_calendar_id: 'cal'
};

const baseAppointment: Appointment = {
	id: 'appt-1',
	event_type_id: 'chat',
	start_time: '2026-04-27T13:00:00Z',
	end_time: '2026-04-27T13:30:00Z',
	guest_name: 'Booker',
	guest_email: 'booker@example.com',
	guest_answers: null,
	location: null,
	note: null,
	video_chat: null,
	video_chat_request: null,
	status: 'confirmed',
	origin_id: 'appt-1',
	cancel_token: 'tok',
	action_log: null,
	external_event_id: null,
	external_calendar_id: null,
	calendar_revision: 0,
	calendar_synced_revision: null,
	has_possible_conflict: 0,
	ics_sequence: 0,
	meeting_snapshot: null,
	created_at: '',
	updated_at: '',
	guest_timezone: 'America/New_York'
};

beforeEach(() => {
	vi.restoreAllMocks();
});

describe('fetchGoogleBusy', () => {
	const window = {
		start: Temporal.Instant.from('2026-01-01T00:00:00Z'),
		end: Temporal.Instant.from('2027-01-01T00:00:00Z')
	};
	const timed = {
		id: 'timed',
		start: { dateTime: '2026-03-08T01:30:00-05:00' },
		end: { dateTime: '2026-03-08T03:30:00-04:00' }
	};
	const allDay = {
		id: 'all-day',
		start: { date: '2026-03-08' },
		end: { date: '2026-03-09' }
	};

	function mockPages(pages: (Record<string, unknown> | Response)[]) {
		const requests: { url: URL; init?: RequestInit }[] = [];
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
			if (String(url).includes('oauth2.googleapis.com/token')) {
				return new Response(JSON.stringify({ access_token: 'busy-token', expires_in: 3600 }));
			}
			const page = pages[requests.length];
			requests.push({ url: new URL(String(url)), init });
			if (page === undefined) throw new Error('Unexpected Google page request');
			if (page instanceof Response) return page;
			return new Response(JSON.stringify(page));
		});
		return requests;
	}

	const busyCfg = { ...cfg, refresh_token: 'busy-refresh', google_calendar_id: 'work@example.com' };

	test('follows short and empty pages through all tokens, preserving the query and auth', async () => {
		const requests = mockPages([
			{ items: [timed], nextPageToken: 'second page' },
			{ items: [], nextPageToken: 'third/page' },
			{ items: [{ ...timed, id: 'last' }] }
		]);

		const events = await fetchGoogleBusy(busyCfg, window);

		expect(events.map((event) => event.uid)).toEqual(['timed', 'last']);
		expect(requests).toHaveLength(3);
		for (const [index, { url, init }] of requests.entries()) {
			expect(url.pathname).toBe('/calendar/v3/calendars/work%40example.com/events');
			expect(Object.fromEntries(url.searchParams)).toEqual({
				timeMin: window.start.toString(),
				timeMax: window.end.toString(),
				singleEvents: 'true',
				orderBy: 'startTime',
				...(index === 0 ? {} : { pageToken: ['second page', 'third/page'][index - 1] })
			});
			expect(init?.headers).toEqual({ Authorization: 'Bearer busy-token' });
		}
	});

	test('rejects instead of returning collected events when the final page fails', async () => {
		const requests = mockPages([
			{ items: [timed], nextPageToken: 'second' },
			{ nextPageToken: 'third' },
			new Response('unavailable', { status: 503, statusText: 'Service Unavailable' })
		]);

		const result = fetchGoogleBusy(busyCfg, window);

		await expect(result).rejects.toThrow('Google Calendar fetch failed: 503');
		expect(requests).toHaveLength(3);
	});

	test('rejects collected events if a later page lacks required timezone evidence', async () => {
		mockPages([
			{ items: [allDay], timeZone: 'America/New_York', nextPageToken: 'second' },
			{ items: [allDay] }
		]);

		const result = fetchGoogleBusy(busyCfg, window);

		await expect(result).rejects.toThrow(/response calendar timeZone/);
	});

	test.each([
		['2026-03-08', '2026-03-09', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z', 23],
		['2026-03-07', '2026-03-09', '2026-03-07T05:00:00Z', '2026-03-09T04:00:00Z', 47],
		['2026-11-01', '2026-11-02', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', 25],
		['2026-10-31', '2026-11-02', '2026-10-31T04:00:00Z', '2026-11-02T05:00:00Z', 49]
	])(
		'uses calendar-zone start of day and exclusive end for %s to %s',
		async (from, to, start, end, hours) => {
			mockPages([
				{
					timeZone: 'America/New_York',
					items: [{ id: 'day', start: { date: from }, end: { date: to } }]
				}
			]);

			const events = await fetchGoogleBusy(busyCfg, window);

			expect(events).toHaveLength(1);
			expect(events[0].start.toString()).toBe(start);
			expect(events[0].end.toString()).toBe(end);
			expect(events[0].start.until(events[0].end).total('hours')).toBe(hours);
		}
	);

	test.each([undefined, null, '', 'Not/A_Zone', 42])(
		'rejects an all-day import with missing or invalid calendar timezone %s',
		async (timeZone) => {
			mockPages([{ items: [allDay], timeZone }]);

			const result = fetchGoogleBusy(busyCfg, window);

			await expect(result).rejects.toThrow();
		}
	);

	test.each([undefined, 'Not/A_Zone'])(
		'preserves timed instants without needing calendar timezone %s',
		async (timeZone) => {
			mockPages([{ items: [timed], timeZone }]);

			const events = await fetchGoogleBusy(busyCfg, window);

			expect(events).toHaveLength(1);
			expect(events[0].start.toString()).toBe('2026-03-08T06:30:00Z');
			expect(events[0].end.toString()).toBe('2026-03-08T07:30:00Z');
		}
	);

	test('filters cancelled and transparent events before requiring time evidence', async () => {
		mockPages([
			{
				items: [
					{ id: 'deleted', status: 'cancelled' },
					{ ...allDay, transparency: 'transparent' },
					{ ...timed, transparency: 'opaque' }
				]
			}
		]);

		const events = await fetchGoogleBusy(busyCfg, window);

		expect(events.map((event) => event.uid)).toEqual(['timed']);
	});

	test.each([
		{},
		{ start: timed.start },
		{ start: {}, end: {} },
		{ start: { dateTime: '' }, end: timed.end },
		{ start: { dateTime: 'not-an-instant' }, end: timed.end },
		{ start: { dateTime: '2026-03-08T01:30:00' }, end: timed.end },
		{ start: { date: '2026-02-30' }, end: allDay.end },
		{ start: { date: '2026-03-08T00:00:00' }, end: allDay.end },
		{ start: { ...timed.start, ...allDay.start }, end: timed.end },
		{ start: allDay.start, end: { ...allDay.end, ...timed.end } },
		{ start: timed.start, end: allDay.end },
		{ start: allDay.start, end: timed.end },
		{ start: timed.start, end: timed.start },
		{ start: timed.end, end: timed.start },
		{ start: allDay.start, end: allDay.start }
	])('rejects malformed or contradictory busy time evidence: %j', async (boundaries) => {
		mockPages([{ timeZone: 'America/New_York', items: [{ id: 'invalid', ...boundaries }] }]);

		const result = fetchGoogleBusy(busyCfg, window);

		await expect(result).rejects.toThrow();
	});

	test.each([{ items: {} }, { items: [null] }, { nextPageToken: 42 }, { nextPageToken: '' }])(
		'rejects malformed page evidence: %j',
		async (page) => {
			mockPages([page]);

			const result = fetchGoogleBusy(busyCfg, window);

			await expect(result).rejects.toThrow();
		}
	);

	test('returns an empty complete import when there are no items', async () => {
		mockPages([{}]);

		const events = await fetchGoogleBusy(busyCfg, window);

		expect(events).toEqual([]);
	});
});

async function push(appointment: Appointment) {
	const captured: {
		url?: string;
		method?: string;
		payload?: Record<string, unknown>;
		result?: unknown;
	} = {};

	vi.spyOn(globalThis, 'fetch').mockImplementation(
		async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
			if (String(url).includes('oauth2.googleapis.com/token')) {
				return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), {
					status: 200
				});
			}
			captured.url = String(url);
			captured.method = init?.method;
			captured.payload = JSON.parse(String(init?.body));
			return new Response(JSON.stringify({ id: 'evt-1' }), { status: 200 });
		}
	);

	captured.result = await putGoogleEvent(cfg, appointment, {
		cancelUrl: 'https://when.example.com/appointment/appt-1?token=tok',
		eventTypeName: 'Chat',
		hostName: 'Jane'
	});
	return captured;
}

test('description and attendees include the email when present', async () => {
	const { payload } = await push({
		...baseAppointment,
		guest_answers: JSON.stringify([
			{ id: 'phone', label: 'Phone', type: 'text', value: '+15550199' }
		])
	});
	expect(payload!.description).toContain('Name: Booker');
	expect(payload!.description).toContain('Email: booker@example.com');
	expect(payload!.description).toContain('Phone: +15550199');
	expect(payload!.attendees).toEqual([{ email: 'booker@example.com', displayName: 'Booker' }]);
});

test('email line is dropped and attendees empty when there is no email', async () => {
	const { payload } = await push({ ...baseAppointment, guest_email: null });
	expect(payload!.description).toContain('Name: Booker');
	expect(payload!.description).not.toContain('Email:');
	expect(payload!.attendees).toEqual([]);
});

test.each([null, 'https://zoom.us/j/12345', 'sip:room@example.com'])(
	'creates appointment content with POST, never conference data, for selected URI %s',
	async (videoChat) => {
		const { url, method, payload } = await push({ ...baseAppointment, video_chat: videoChat });
		expect(method).toBe('POST');
		expect(url).toBe(
			'https://www.googleapis.com/calendar/v3/calendars/cal/events?sendUpdates=none'
		);
		expect(payload).not.toHaveProperty('conferenceData');
		if (videoChat) expect(payload?.description).toContain(videoChat);
	}
);

test.each([null, 'https://meet.google.com/selected', 'sip:room@example.com'])(
	'updates content with encoded-ID PATCH, preserving native conferences, for selected URI %s',
	async (videoChat) => {
		const { url, method, payload, result } = await push({
			...baseAppointment,
			external_event_id: 'existing/event?1',
			video_chat: videoChat
		});
		expect(method).toBe('PATCH');
		expect(url).toBe(
			'https://www.googleapis.com/calendar/v3/calendars/cal/events/existing%2Fevent%3F1?sendUpdates=none'
		);
		expect(payload).not.toHaveProperty('conferenceData');
		if (videoChat) expect(payload?.description).toContain(videoChat);
		expect(result).toEqual({ externalEventId: 'existing/event?1' });
	}
);

test('PATCH explicitly clears removed location content without touching conference fields', async () => {
	const { payload } = await push({
		...baseAppointment,
		external_event_id: 'existing',
		location: null
	});
	expect(payload?.location).toBeNull();
	expect(payload).not.toHaveProperty('conferenceData');
});

test('PATCH accepts a no-content acknowledgment and keeps the stored event ID', async () => {
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
		if (String(url).includes('oauth2.googleapis.com/token')) {
			return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
		}
		return new Response(null, { status: 204 });
	});
	const result = await putGoogleEvent(
		cfg,
		{ ...baseAppointment, external_event_id: 'existing' },
		{
			cancelUrl: 'https://when.example.com/booked/appt-1',
			eventTypeName: 'Chat',
			hostName: 'Jane'
		}
	);
	expect(result).toEqual({ externalEventId: 'existing' });
});

test('deleteGoogleEvent includes sendUpdates=none', async () => {
	const fetchSpy = vi
		.spyOn(globalThis, 'fetch')
		.mockImplementation(async (url: Parameters<typeof fetch>[0]) => {
			if (String(url).includes('oauth2.googleapis.com/token')) {
				return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), {
					status: 200
				});
			}
			return new Response(null, { status: 204 });
		});

	await deleteGoogleEvent(cfg, 'evt-to-delete');
	expect(fetchSpy).toHaveBeenCalledWith(
		'https://www.googleapis.com/calendar/v3/calendars/cal/events/evt-to-delete?sendUpdates=none',
		expect.objectContaining({ method: 'DELETE' })
	);
});

// getGoogleAccessToken is re-exported for the CLI (service test/token/calendars).
// The token cache keys on refresh_token, so each case uses a distinct one.
test('getGoogleAccessToken refreshes and returns the access token', async () => {
	const fetchSpy = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(
			new Response(JSON.stringify({ access_token: 'access-1', expires_in: 3600 }), { status: 200 })
		);
	const token = await getGoogleAccessToken({ ...cfg, refresh_token: 'refresh-ok' });
	expect(token).toBe('access-1');
	expect(fetchSpy).toHaveBeenCalledOnce();
});

test('getGoogleAccessToken throws when the refresh request fails', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response('nope', { status: 400, statusText: 'Bad Request' })
	);
	await expect(getGoogleAccessToken({ ...cfg, refresh_token: 'refresh-fail' })).rejects.toThrow(
		/token refresh failed/
	);
});

test('getGoogleAccessToken caches by refresh token and skips a second request', async () => {
	const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(JSON.stringify({ access_token: 'access-cached', expires_in: 3600 }), {
			status: 200
		})
	);
	const first = await getGoogleAccessToken({ ...cfg, refresh_token: 'refresh-cache' });
	const second = await getGoogleAccessToken({ ...cfg, refresh_token: 'refresh-cache' });
	expect(first).toBe('access-cached');
	expect(second).toBe('access-cached');
	expect(fetchSpy).toHaveBeenCalledOnce();
});

test('buildGoogleAuthUrl carries a state nonce when given one', () => {
	const url = new URL(
		buildGoogleAuthUrl({ clientId: 'c', redirectUri: 'https://x.example/cb', state: 'nonce-1' })
	);
	expect(url.searchParams.get('state')).toBe('nonce-1');
});

test('buildGoogleAuthUrl omits state when none is given', () => {
	const url = new URL(buildGoogleAuthUrl({ clientId: 'c', redirectUri: 'https://x.example/cb' }));
	expect(url.searchParams.has('state')).toBe(false);
});

test('buildGoogleAuthUrl includes client, scopes, and offline consent', () => {
	const url = new URL(
		buildGoogleAuthUrl({ clientId: 'client-123', redirectUri: 'http://localhost' })
	);
	expect(url.searchParams.get('client_id')).toBe('client-123');
	expect(url.searchParams.get('redirect_uri')).toBe('http://localhost');
	expect(url.searchParams.get('access_type')).toBe('offline');
	expect(url.searchParams.get('prompt')).toBe('consent');
	expect(url.searchParams.get('scope')).toContain('calendar.events');
});

test('exchangeGoogleAuthCode returns the token payload', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(JSON.stringify({ access_token: 'a', refresh_token: 'RT', expires_in: 3600 }), {
			status: 200
		})
	);
	const tokens = await exchangeGoogleAuthCode('cid', 'secret', 'code', 'http://localhost');
	expect(tokens.refresh_token).toBe('RT');
});

test('exchangeGoogleAuthCode throws on a non-ok response', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad', { status: 400 }));
	await expect(exchangeGoogleAuthCode('cid', 'secret', 'code', 'http://localhost')).rejects.toThrow(
		/exchange failed/
	);
});

test('listGoogleCalendars returns items and throws on failure', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(JSON.stringify({ items: [{ id: 'primary', summary: 'Me', primary: true }] }), {
			status: 200
		})
	);
	const calendars = await listGoogleCalendars('tok');
	expect(calendars).toEqual([{ id: 'primary', summary: 'Me', primary: true }]);

	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 401 }));
	await expect(listGoogleCalendars('tok')).rejects.toThrow(/calendar list failed/);
});

test('revokeGoogleToken posts the refresh token to google', async () => {
	const fetchMock = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(new Response('', { status: 200 }));

	await revokeGoogleToken('rt-1');

	const [url, init] = fetchMock.mock.calls[0];
	expect(url).toBe('https://oauth2.googleapis.com/revoke');
	expect(String((init as RequestInit).body)).toContain('token=rt-1');
});

test('revokeGoogleToken throws when google rejects the revoke', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad', { status: 400 }));

	await expect(revokeGoogleToken('rt-1')).rejects.toThrow(/revoke failed/);
});

describe('GoogleAdapter.pushAppointment', () => {
	test.each([true, false])(
		'ignores video attach policy auto=%s and never adopts a returned URI',
		async (auto) => {
			const { GoogleAdapter } = await import('./google.js');
			const adapter = new GoogleAdapter(
				'primary',
				{ id: 'cal', sync: { refresh_every_minutes: 5 } },
				{ type: 'google', client_id: 'i', client_secret: 's', refresh_token: 'r', calendars: {} }
			);
			const config = {
				user: { name: 'Jane' },
				providers: { google: { type: 'google' } },
				meetings: { chat: { video_chat: { provider: 'google', attach: { auto } } } }
			} as unknown as import('@when/config').WhenConfiguration;
			let payload: Record<string, unknown> | undefined;
			vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
				if (String(url).includes('oauth2.googleapis.com/token')) {
					return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
				}
				payload = JSON.parse(String(init?.body));
				return new Response(
					JSON.stringify({
						id: 'evt-1',
						conferenceData: {
							entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/unselected' }]
						}
					})
				);
			});

			const result = await adapter.pushAppointment(config, baseAppointment, 'Chat', {
				cancelUrl: 'https://when.example.com/booked/appt-1'
			});

			expect(payload).not.toHaveProperty('conferenceData');
			expect(result).toEqual({ ok: true, externalEventId: 'evt-1', externalCalendarId: 'primary' });
		}
	);
});
