import type { WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';
import type { BookingLinks } from '../../links.js';
import type { BookingEmailInput } from '../types.js';

export const sampleAppointment: Appointment = {
	id: 'appt-1',
	event_type_id: '30-min',
	start_time: '2026-01-05T15:00:00Z',
	end_time: '2026-01-05T15:30:00Z',
	attendee_name: 'Jane Doe',
	attendee_email: 'jane@example.com',
	attendee_notes: 'Looking forward to it',
	attendee_timezone: 'America/Los_Angeles',
	location: 'Zoom',
	status: 'confirmed',
	cancel_token: 'tok-1',
	external_event_id: null,
	external_calendar_id: null,
	email_notification_status: null,
	calendar_push_notification_status: null,
	calendar_revision: 0,
	calendar_synced_revision: null,
	has_possible_conflict: 0,
	calendar_push_failing_since: null,
	ics_sequence: 0,
	created_at: '2026-01-01T09:00:00Z',
	updated_at: '2026-01-01T09:00:00Z',
	origin_id: null,
	rescheduled_from_id: null,
	rescheduled_to_id: null
};

// Only the fields the email code reads; cast past the full config shape.
export const sampleConfig = {
	user: {
		name: 'Acme Scheduling',
		email: 'owner@acme.test',
		timezone: 'America/New_York',
		branding: {
			color: {
				primary: {
					light: '#2563eb',
					dark: '#3b82f6'
				}
			}
		}
	},
	smtp: { host: 'smtp.test', port: 587, user: 'mailer', pass: 'secret' },
	url: { app: 'https://when.example.com' },
	event_types: []
} as unknown as WhenConfiguration;

export const sampleLinks: BookingLinks = {
	booked: 'https://when.example.com/booked/appt-1',
	cancel: 'https://when.example.com/booked/appt-1?cancel=1',
	reschedule: 'https://when.example.com/schedule/30-min',
	manage: 'https://when.example.com/signin'
};

export const sampleInput: BookingEmailInput = {
	cfg: sampleConfig,
	appointment: sampleAppointment,
	eventType: undefined,
	links: sampleLinks,
	logo: null
};
