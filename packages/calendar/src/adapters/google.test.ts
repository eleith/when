import { expect, test } from 'vitest';
import { putGoogleEvent, type GoogleConfig } from './google.js';
import type { FetchFn } from './caldav.js';
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
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_answers: null,
	location: null,
	status: 'confirmed',
	origin_id: 'appt-1',
	rescheduled_from_id: null,
	rescheduled_to_id: null,
	cancel_token: 'tok',
	action_log: null,
	external_event_id: null,
	external_calendar_id: null,
	email_notification_status: null,
	calendar_push_notification_status: null,
	calendar_revision: 0,
	calendar_synced_revision: null,
	has_possible_conflict: 0,
	calendar_push_failing_since: null,
	ics_sequence: 0,
	event_type_snapshot: null,
	created_at: '',
	updated_at: '',
	attendee_timezone: 'America/New_York'
};

function mockFetch(captured: { payload?: Record<string, unknown> }): FetchFn {
	return (async (url: string | URL, init?: RequestInit) => {
		if (String(url).includes('oauth2.googleapis.com/token')) {
			return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
		}
		captured.payload = JSON.parse(String(init?.body));
		return new Response(JSON.stringify({ id: 'evt-1' }), { status: 200 });
	}) as FetchFn;
}

async function push(appointment: Appointment) {
	const captured: { payload?: Record<string, unknown> } = {};
	await putGoogleEvent(cfg, appointment, {
		cancelUrl: 'https://when.example.com/appointment/appt-1?token=tok',
		eventTypeName: 'Chat',
		organizerName: 'Jane',
		fetchImpl: mockFetch(captured)
	});
	return captured.payload!;
}

test('description and attendees include the email when present', async () => {
	const payload = await push({
		...baseAppointment,
		attendee_answers: JSON.stringify([
			{ id: 'phone', label: 'Phone', type: 'text', value: '+15550199' }
		])
	});
	expect(payload.description).toContain('Name: Booker');
	expect(payload.description).toContain('Email: booker@example.com');
	expect(payload.description).toContain('Phone: +15550199');
	expect(payload.attendees).toEqual([{ email: 'booker@example.com', displayName: 'Booker' }]);
});

test('email line is dropped and attendees empty when there is no email', async () => {
	const payload = await push({ ...baseAppointment, attendee_email: null });
	expect(payload.description).toContain('Name: Booker');
	expect(payload.description).not.toContain('Email:');
	expect(payload.attendees).toEqual([]);
});
