import { expect, test, vi, beforeEach } from 'vitest';
import { putGoogleEvent, type GoogleConfig } from './google.js';
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
	event_type_snapshot: null,
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
