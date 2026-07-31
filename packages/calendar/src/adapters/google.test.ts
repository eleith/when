import { expect, test, vi, beforeEach } from 'vitest';
import {
	getGoogleAccessToken,
	buildGoogleAuthUrl,
	exchangeGoogleAuthCode,
	revokeGoogleToken,
	listGoogleCalendars,
	putGoogleEvent,
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

async function push(appointment: Appointment) {
	const captured: { url?: string; payload?: Record<string, unknown> } = {};

	vi.spyOn(globalThis, 'fetch').mockImplementation(
		async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
			if (String(url).includes('oauth2.googleapis.com/token')) {
				return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), {
					status: 200
				});
			}
			captured.url = String(url);
			captured.payload = JSON.parse(String(init?.body));
			return new Response(JSON.stringify({ id: 'evt-1' }), { status: 200 });
		}
	);

	await putGoogleEvent(cfg, appointment, {
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

test('includes conferenceData and appends version query parameter when video_chat link is present', async () => {
	const { url, payload } = await push({
		...baseAppointment,
		video_chat: 'https://zoom.us/j/12345'
	});
	expect(url).toContain('conferenceDataVersion=1');
	expect(payload?.conferenceData).toEqual({
		entryPoints: [
			{
				entryPointType: 'video',
				uri: 'https://zoom.us/j/12345'
			}
		]
	});
});

test('omits conferenceData when video_chat link is absent', async () => {
	const { payload } = await push(baseAppointment);
	expect(payload?.conferenceData).toBeUndefined();
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
	expect(await listGoogleCalendars('tok')).toEqual([
		{ id: 'primary', summary: 'Me', primary: true }
	]);

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
