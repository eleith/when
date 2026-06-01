import { Temporal } from '@js-temporal/polyfill';
import { logger } from '../../logger';
import type { BusyEvent } from '../types';
import type { Appointment } from '../../db';
import type { FetchBusyOptions, FetchFn } from './caldav';
import type { CalendarAdapter, PushOptions, PushResult, DeleteResult } from '../adapter';
import type { WhenConfiguration, GoogleCalendar } from '@when/config';
import type { ExpandWindow } from '../expand';

export interface GoogleConfig {
	client_id: string;
	client_secret: string;
	refresh_token: string;
	google_calendar_id: string;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getGoogleAccessToken(
	cfg: GoogleConfig,
	fetchImpl: FetchFn = fetch
): Promise<string> {
	const cacheKey = cfg.refresh_token;
	const cached = tokenCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.token;
	}

	const res = await fetchImpl('https://oauth2.googleapis.com/token', {
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

	const data = await res.json();
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
	opts: FetchBusyOptions,
	fetchImpl: FetchFn = fetch
): Promise<BusyEvent[]> {
	const token = await getGoogleAccessToken(cfg, fetchImpl);
	const calId = encodeURIComponent(cfg.google_calendar_id);

	const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events`);
	url.searchParams.set('timeMin', opts.start.toString());
	url.searchParams.set('timeMax', opts.end.toString());
	url.searchParams.set('singleEvents', 'true');
	url.searchParams.set('orderBy', 'startTime');

	const res = await fetchImpl(url.toString(), {
		headers: { Authorization: `Bearer ${token}` }
	});

	if (!res.ok) {
		throw new Error(`Google Calendar fetch failed: ${res.status} ${res.statusText}`);
	}

	const data = await res.json();
	const out: BusyEvent[] = [];

	for (const item of data.items || []) {
		if (item.status === 'cancelled') continue;
		if (item.transparency === 'transparent') continue; // Available/Free

		let startInst: Temporal.Instant;
		let endInst: Temporal.Instant;

		try {
			if (item.start?.dateTime) {
				startInst = Temporal.Instant.from(item.start.dateTime);
				endInst = Temporal.Instant.from(item.end.dateTime);
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
	organizerName: string;
	fetchImpl?: FetchFn;
}

/**
 * Create or update an event in Google Calendar.
 */
export async function putGoogleEvent(
	cfg: GoogleConfig,
	appointment: Appointment,
	opts: GooglePushOptions
): Promise<{ externalEventId: string }> {
	const token = await getGoogleAccessToken(cfg, opts.fetchImpl ?? fetch);
	const calId = encodeURIComponent(cfg.google_calendar_id);

	// Existing events are updated via PUT with the stored external_event_id;
	// new events are created via POST and the returned event ID is stored.
	const isUpdate = !!appointment.external_event_id;
	const eventId = isUpdate ? appointment.external_event_id : '';

	const url = isUpdate
		? `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${eventId}`
		: `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`;

	const method = isUpdate ? 'PUT' : 'POST';

	const payload = {
		summary: `${opts.eventTypeName} with ${appointment.attendee_name}`,
		description: `Name: ${appointment.attendee_name}\nEmail: ${appointment.attendee_email}\n\n${appointment.attendee_notes ? `Notes: ${appointment.attendee_notes}\n\n` : ''}Cancel or reschedule: ${opts.cancelUrl}`,
		location: appointment.location || undefined,
		start: { dateTime: appointment.start_time },
		end: { dateTime: appointment.end_time },
		attendees: [{ email: appointment.attendee_email, displayName: appointment.attendee_name }]
	};

	const res = await (opts.fetchImpl ?? fetch)(url, {
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

	const data = await res.json();
	return { externalEventId: data.id };
}

/**
 * Delete an event from Google Calendar.
 */
export async function deleteGoogleEvent(
	cfg: GoogleConfig,
	externalEventId: string,
	opts: { fetchImpl?: FetchFn } = {}
): Promise<void> {
	const token = await getGoogleAccessToken(cfg, opts.fetchImpl ?? fetch);
	const calId = encodeURIComponent(cfg.google_calendar_id);
	const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${externalEventId}`;

	const res = await (opts.fetchImpl ?? fetch)(url, {
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
	constructor(private cal: GoogleCalendar) {}

	async fetchBusy(window: ExpandWindow, opts?: { fetchImpl?: FetchFn }) {
		return fetchGoogleBusy(this.cal, { start: window.start, end: window.end }, opts?.fetchImpl);
	}

	async pushAppointment(
		cfg: WhenConfiguration,
		appointment: Appointment,
		eventTypeName: string,
		opts: PushOptions
	): Promise<PushResult> {
		const result = await putGoogleEvent(this.cal, appointment, {
			cancelUrl: opts.cancelUrl,
			eventTypeName,
			organizerName: cfg.user.name,
			fetchImpl: opts.fetchImpl
		});
		return { ok: true, externalEventId: result.externalEventId, externalCalendarId: this.cal.id };
	}

	async deleteAppointment(
		externalEventId: string,
		opts?: { fetchImpl?: FetchFn }
	): Promise<DeleteResult> {
		await deleteGoogleEvent(this.cal, externalEventId, { fetchImpl: opts?.fetchImpl });
		return { ok: true };
	}
}
