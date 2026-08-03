import { expect, test, vi, beforeEach } from 'vitest';
import { deleteCalDavEvent, putCalDavEvent } from './adapters/caldav.js';
import { deleteAppointmentFromCalendar, pushAppointment } from './push.js';
import type { ConnectedProvider } from './adapter.js';
import type { Appointment } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { validConfig } from './__fixtures__/valid-config.js';

const caldavCfg = { url: 'https://cal.example.com/work/', username: 'jane', password: 'secret' };

const baseAppointment: Appointment = {
	id: 'appt-xyz',
	event_type_id: '30-min-chat',
	start_time: '2026-04-27T13:00:00Z',
	end_time: '2026-04-27T13:30:00Z',
	guest_name: 'Booker',
	guest_email: 'booker@example.com',
	guest_answers: null,
	location: null,
	note: null,
	video_chat: null,
	status: 'confirmed',
	origin_id: 'appt-xyz',
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

const davServices: ConnectedProvider[] = [
	{
		name: 'work-dav-service',
		type: 'caldav',
		url: caldavCfg.url,
		username: 'jane',
		password: 'secret',
		calendars: []
	}
];

const cfgWithCalDav: WhenConfiguration = {
	...validConfig,
	providers: [
		{
			name: 'work-dav-service',
			type: 'caldav',
			url: caldavCfg.url,
			username: 'jane',
			password: 'secret',
			calendars: [{ name: 'work', href: caldavCfg.url, sync: { refresh_every_minutes: 10 } }]
		}
	],
	meetings: [
		{
			...validConfig.meetings[0],
			booking_calendar: 'work'
		}
	]
};

beforeEach(() => {
	vi.restoreAllMocks();
});

test('putCalDavEvent issues PUT with basic auth and text/calendar body', async () => {
	let captured: { url: string; init: RequestInit } | null = null;
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		captured = { url: String(url), init: init as RequestInit };
		return new Response('', { status: 201, headers: { etag: '"abc"' } });
	});

	const result = await putCalDavEvent(caldavCfg, 'appt-xyz', 'BEGIN:VCALENDAR\nEND:VCALENDAR');
	expect(result.url).toBe('https://cal.example.com/work/appt-xyz.ics');
	expect(result.etag).toBe('"abc"');
	expect(captured).not.toBeNull();
	const init = captured!.init;
	expect(init.method).toBe('PUT');
	const headers = init.headers as Record<string, string>;
	expect(headers['Content-Type']).toContain('text/calendar');
	const expected = 'Basic ' + Buffer.from('jane:secret').toString('base64');
	expect(headers['Authorization']).toBe(expected);
});

test('putCalDavEvent forwards If-Match when etag is provided', async () => {
	let captured: RequestInit | null = null;
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
		captured = init as RequestInit;
		return new Response(null, { status: 204 });
	});

	await putCalDavEvent(caldavCfg, 'appt-xyz', 'BEGIN:VCALENDAR\nEND:VCALENDAR', {
		etag: '"prev"'
	});
	expect(captured).not.toBeNull();
	const headers = (captured as unknown as RequestInit).headers as Record<string, string>;
	expect(headers['If-Match']).toBe('"prev"');
});

test('putCalDavEvent throws on non-2xx', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response('forbidden', { status: 403, statusText: 'Forbidden' })
	);
	await expect(putCalDavEvent(caldavCfg, 'appt-xyz', 'x')).rejects.toThrow(/403/);
});

test('deleteCalDavEvent treats 404 as success', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
	await deleteCalDavEvent(caldavCfg, 'appt-xyz');
});

test('deleteCalDavEvent throws on 5xx', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response('boom', { status: 500, statusText: 'Internal Server Error' })
	);
	await expect(deleteCalDavEvent(caldavCfg, 'appt-xyz')).rejects.toThrow(/500/);
});

test('pushAppointment routes to CalDAV PUT and returns external ids', async () => {
	let body = '';
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
		body = (init as RequestInit).body as string;
		return new Response('', { status: 201 });
	});

	const result = await pushAppointment(cfgWithCalDav, davServices, baseAppointment, 'work', {
		cancelUrl: 'https://when.example.com/appointment/appt-xyz?token=tok'
	});
	expect(result.ok).toBe(true);
	if (result.ok) {
		expect(result.externalEventId).toBe('appt-xyz');
		expect(result.externalCalendarId).toBe('work');
	}
	expect(body).toContain('BEGIN:VCALENDAR');
	expect(body).toContain('UID:appt-xyz');
});

test('pushAppointment fails cleanly when the google service is not connected', async () => {
	const cfgGoogle: WhenConfiguration = {
		...validConfig,
		providers: [
			{
				name: 'google-service-2',
				type: 'google',
				client_id: 'gid',
				client_secret: 'gsec',
				calendars: [{ name: 'g', id: 'gcal', sync: { refresh_every_minutes: 10 } }]
			}
		],
		meetings: [{ ...validConfig.meetings[0], booking_calendar: 'g' }]
	};

	const disconnected: ConnectedProvider[] = [
		{
			name: 'google-service-2',
			type: 'google',
			client_id: 'gid',
			client_secret: 'gsec',
			calendars: [],
			refresh_token: null
		}
	];
	const fetchSpy = vi.spyOn(globalThis, 'fetch');

	const result = await pushAppointment(cfgGoogle, disconnected, baseAppointment, 'g', {
		cancelUrl: 'https://when.example.com/appointment/appt-xyz?token=tok'
	});

	expect(result.ok).toBe(false);
	if (!result.ok) expect(result.reason).toContain('not connected');
	expect(fetchSpy).not.toHaveBeenCalled();
});

test('pushAppointment succeeds on Google calendar', async () => {
	const cfgGoogle: WhenConfiguration = {
		...validConfig,
		providers: [
			{
				name: 'google-service-2',
				type: 'google',
				client_id: 'gid',
				client_secret: 'gsec',
				calendars: [{ name: 'g', id: 'gcal', sync: { refresh_every_minutes: 10 } }]
			}
		],
		meetings: [{ ...validConfig.meetings[0], booking_calendar: 'g' }]
	};

	let reqCount = 0;
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		reqCount++;
		const url = input.toString();
		if (url.includes('oauth2')) {
			return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
				status: 200
			});
		} else if (url.includes('events')) {
			return new Response(JSON.stringify({ id: 'ext-g-123' }), { status: 200 });
		}
		return new Response('Not found', { status: 404 });
	});

	const connectedGoogle: ConnectedProvider[] = [
		{
			name: 'google-service-2',
			type: 'google',
			client_id: 'gid',
			client_secret: 'gsec',
			calendars: [],
			refresh_token: 'gtoken'
		}
	];
	const result = await pushAppointment(cfgGoogle, connectedGoogle, baseAppointment, 'g', {
		cancelUrl: 'https://when.example.com/appointment/appt-xyz?token=tok'
	});

	expect(result.ok).toBe(true);
	if (result.ok) {
		expect(result.externalEventId).toBe('ext-g-123');
		expect(result.externalCalendarId).toBe('g');
	}
	expect(reqCount).toBe(2);
});

test('pushAppointment fails on unknown destination calendar id', async () => {
	const result = await pushAppointment(cfgWithCalDav, davServices, baseAppointment, 'nope', {
		cancelUrl: 'https://when.example.com/appointment/appt-xyz?token=tok'
	});
	expect(result.ok).toBe(false);
});

test('pushAppointment surfaces network failures as ok:false', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response('', { status: 500, statusText: 'Internal Server Error' })
	);
	const result = await pushAppointment(cfgWithCalDav, davServices, baseAppointment, 'work', {
		cancelUrl: 'https://when.example.com/appointment/appt-xyz?token=tok'
	});
	expect(result.ok).toBe(false);
});

test('deleteAppointmentFromCalendar returns ok on success', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
	const result = await deleteAppointmentFromCalendar(
		cfgWithCalDav,
		davServices,
		'work',
		'appt-xyz'
	);
	expect(result.ok).toBe(true);
});

test('deleteAppointmentFromCalendar returns ok on 404 (already gone)', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
	const result = await deleteAppointmentFromCalendar(
		cfgWithCalDav,
		davServices,
		'work',
		'appt-xyz'
	);
	expect(result.ok).toBe(true);
});
