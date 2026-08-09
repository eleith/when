import { describeAppointment } from '../description.js';
import { guestContact } from '../guest.js';
import { logger } from '../logger.js';
import type { BusyEvent } from '../types.js';
import type { Appointment } from '@when/db';
import type { FetchBusyOptions } from './caldav.js';
import type { CalendarAdapter, PushOptions, PushResult, DeleteResult } from '../adapter.js';
import type { WhenConfiguration, GoogleCalendar, GoogleProvider } from '@when/config';
import type { ExpandWindow } from '../expand.js';

export interface GoogleConfig {
	client_id: string;
	client_secret: string;
	refresh_token: string;
	google_calendar_id: string;
}

interface GoogleTokenResponse {
	access_token: string;
	expires_in: number;
}

/** A Google event time: `dateTime` for timed events, `date` for all-day. */
interface GoogleEventTime {
	dateTime?: string;
	date?: string;
}

interface GoogleEvent {
	id: string;
	status?: string;
	transparency?: string;
	start: GoogleEventTime;
	end: GoogleEventTime;
}

interface GoogleEventsResponse {
	items?: GoogleEvent[];
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getGoogleAccessToken(cfg: GoogleConfig): Promise<string> {
	const cacheKey = cfg.refresh_token;
	const cached = tokenCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.token;
	}

	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: cfg.client_id,
			client_secret: cfg.client_secret,
			refresh_token: cfg.refresh_token,
			grant_type: 'refresh_token'
		})
	});

	if (!res.ok) {
		throw new Error(`Google token refresh failed: ${res.status} ${res.statusText}`);
	}

	const data = (await res.json()) as GoogleTokenResponse;
	const token = data.access_token;
	const expiresAt = Date.now() + (data.expires_in - 60) * 1000;
	tokenCache.set(cacheKey, { token, expiresAt });
	return token;
}

/**
 * Fetch busy events from Google Calendar. We use `singleEvents=true`
 * to let Google expand all recurrences for us, simplifying the output.
 */
export async function fetchGoogleBusy(
	cfg: GoogleConfig,
	opts: FetchBusyOptions
): Promise<BusyEvent[]> {
	const token = await getGoogleAccessToken(cfg);
	const calId = encodeURIComponent(cfg.google_calendar_id);

	const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events`);
	url.searchParams.set('timeMin', opts.start.toString());
	url.searchParams.set('timeMax', opts.end.toString());
	url.searchParams.set('singleEvents', 'true');
	url.searchParams.set('orderBy', 'startTime');

	const res = await fetch(url.toString(), {
		headers: { Authorization: `Bearer ${token}` }
	});

	if (!res.ok) {
		throw new Error(`Google Calendar fetch failed: ${res.status} ${res.statusText}`);
	}

	const data = (await res.json()) as GoogleEventsResponse;
	const out: BusyEvent[] = [];

	for (const item of data.items || []) {
		if (item.status === 'cancelled') continue;
		if (item.transparency === 'transparent') continue; // Available/Free

		let startInst: Temporal.Instant;
		let endInst: Temporal.Instant;

		try {
			if (item.start?.dateTime) {
				startInst = Temporal.Instant.from(item.start.dateTime);
				endInst = Temporal.Instant.from(item.end.dateTime!);
			} else if (item.start?.date) {
				// All-day event
				// Google dates are YYYY-MM-DD. We assume UTC for the comparison window
				// to ensure we block the whole day.
				startInst = Temporal.Instant.from(`${item.start.date}T00:00:00Z`);
				endInst = Temporal.Instant.from(`${item.end.date}T00:00:00Z`);
			} else {
				continue; // Missing start/end
			}
		} catch (err) {
			logger.warn({ err, eventId: item.id }, 'Failed to parse Google event time');
			continue;
		}

		out.push({
			uid: item.id,
			start: startInst,
			end: endInst
		});
	}

	logger.debug(
		{ calendarId: cfg.google_calendar_id, count: out.length },
		'fetched Google busy events'
	);
	return out;
}

export interface GooglePushOptions {
	cancelUrl: string;
	eventTypeName: string;
	hostName: string;
}

/**
 * Create or update an event in Google Calendar.
 */
export async function putGoogleEvent(
	cfg: GoogleConfig,
	appointment: Appointment,
	opts: GooglePushOptions
): Promise<{ externalEventId: string; videoChatUrl?: string }> {
	const token = await getGoogleAccessToken(cfg);
	const calId = encodeURIComponent(cfg.google_calendar_id);

	// Existing events are updated via PUT with the stored external_event_id;
	// new events are created via POST and the returned event ID is stored.
	const isUpdate = !!appointment.external_event_id;
	const eventId = isUpdate ? appointment.external_event_id : '';

	const url = isUpdate
		? `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}?conferenceDataVersion=1`
		: `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?conferenceDataVersion=1`;

	const method = isUpdate ? 'PUT' : 'POST';

	const guest = guestContact(appointment);
	let conferenceData = undefined;
	if (appointment.video_chat === 'google-meet') {
		conferenceData = {
			createRequest: {
				requestId: appointment.id,
				conferenceSolutionKey: {
					type: 'hangoutsMeet'
				}
			}
		};
	} else if (appointment.video_chat && appointment.video_chat.startsWith('http')) {
		conferenceData = {
			entryPoints: [
				{
					entryPointType: 'video',
					uri: appointment.video_chat
				}
			]
		};
	}

	const payload = {
		summary: `${opts.eventTypeName} with ${appointment.guest_name}`,
		description: describeAppointment(appointment, opts.cancelUrl),
		location: appointment.location || undefined,
		start: { dateTime: appointment.start_time },
		end: { dateTime: appointment.end_time },
		attendees: guest ? [{ email: guest.email, displayName: guest.name }] : [],
		conferenceData
	};

	const res = await fetch(url, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payload)
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Google Calendar ${method} failed: ${res.status} ${text}`);
	}

	interface GoogleEventResponse {
		id: string;
		conferenceData?: {
			entryPoints?: {
				entryPointType: string;
				uri?: string;
			}[];
		};
	}

	const data = (await res.json()) as GoogleEventResponse;
	let videoChatUrl: string | undefined;
	if (data.conferenceData?.entryPoints) {
		const meetEntryPoint = data.conferenceData.entryPoints.find(
			(ep) => ep.entryPointType === 'video'
		);
		if (meetEntryPoint?.uri) {
			videoChatUrl = meetEntryPoint.uri;
		}
	}

	return { externalEventId: data.id, videoChatUrl };
}

/**
 * Delete an event from Google Calendar.
 */
export async function deleteGoogleEvent(cfg: GoogleConfig, externalEventId: string): Promise<void> {
	const token = await getGoogleAccessToken(cfg);
	const calId = encodeURIComponent(cfg.google_calendar_id);
	const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${externalEventId}`;

	const res = await fetch(url, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${token}` }
	});

	if (!res.ok && res.status !== 404 && res.status !== 410) {
		// 410 Gone is also common for deleted items
		const text = await res.text();
		throw new Error(`Google Calendar DELETE failed: ${res.status} ${text}`);
	}
}

export class GoogleAdapter implements CalendarAdapter {
	private name: string;
	private cal: GoogleCalendar;
	private service: GoogleProvider;

	constructor(name: string, cal: GoogleCalendar, service: GoogleProvider) {
		this.name = name;
		this.cal = cal;
		this.service = service;
	}

	private get googleCfg(): GoogleConfig {
		if (!this.service.refresh_token) {
			throw new Error(`Google provider for calendar "${this.name}" is not connected`);
		}
		return {
			client_id: this.service.client_id,
			client_secret: this.service.client_secret,
			refresh_token: this.service.refresh_token,
			google_calendar_id: this.cal.id
		};
	}

	async fetchBusy(window: ExpandWindow) {
		return fetchGoogleBusy(this.googleCfg, { start: window.start, end: window.end });
	}

	async pushAppointment(
		cfg: WhenConfiguration,
		appointment: Appointment,
		eventTypeName: string,
		opts: PushOptions
	): Promise<PushResult> {
		const result = await putGoogleEvent(this.googleCfg, appointment, {
			cancelUrl: opts.cancelUrl,
			eventTypeName,
			hostName: cfg.user.name
		});
		return {
			ok: true,
			externalEventId: result.externalEventId,
			externalCalendarId: this.name,
			videoChatUrl: result.videoChatUrl
		};
	}

	async deleteAppointment(externalEventId: string): Promise<DeleteResult> {
		await deleteGoogleEvent(this.googleCfg, externalEventId);
		return { ok: true };
	}
}

const OAUTH_SCOPES = [
	'https://www.googleapis.com/auth/calendar.events',
	'https://www.googleapis.com/auth/calendar.readonly'
].join(' ');

export interface GoogleTokens {
	access_token: string;
	refresh_token: string;
	expires_in: number;
}

export interface GoogleCalendarItem {
	id: string;
	summary: string;
	primary?: boolean;
}

export interface GoogleAuthUrlOptions {
	clientId: string;
	redirectUri: string;
	state?: string;
}

export function buildGoogleAuthUrl(opts: GoogleAuthUrlOptions): string {
	const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
	url.searchParams.set('client_id', opts.clientId);
	url.searchParams.set('redirect_uri', opts.redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', OAUTH_SCOPES);
	url.searchParams.set('access_type', 'offline');
	url.searchParams.set('prompt', 'consent');
	if (opts.state) url.searchParams.set('state', opts.state);
	return url.toString();
}

// Google issues long-lived refresh tokens and never rotates them, so dropping a stored
// token leaves it valid. Revoking is the only way to actually end access.
export async function revokeGoogleToken(refreshToken: string): Promise<void> {
	const res = await fetch('https://oauth2.googleapis.com/revoke', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ token: refreshToken })
	});
	if (!res.ok) {
		throw new Error(`Google token revoke failed: ${res.status} ${await res.text()}`);
	}
}

export async function exchangeGoogleAuthCode(
	clientId: string,
	clientSecret: string,
	code: string,
	redirectUri: string
): Promise<GoogleTokens> {
	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			grant_type: 'authorization_code',
			redirect_uri: redirectUri
		})
	});
	if (!res.ok) {
		throw new Error(`Google auth-code exchange failed: ${res.status} ${await res.text()}`);
	}
	return (await res.json()) as GoogleTokens;
}

export async function listGoogleCalendars(accessToken: string): Promise<GoogleCalendarItem[]> {
	const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (!res.ok) {
		throw new Error(`Google calendar list failed: ${res.status} ${await res.text()}`);
	}
	const data = (await res.json()) as { items?: GoogleCalendarItem[] };
	return data.items ?? [];
}
