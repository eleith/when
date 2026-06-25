import type { WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';
import type { AppointmentLinks } from '../../links.js';
import type { AppointmentEmailInput } from '../types.js';

export const sampleAppointment: Appointment = {
	id: 'appt-1',
	event_type_id: '30-min',
	start_time: '2026-01-05T15:00:00Z',
	end_time: '2026-01-05T15:30:00Z',
	guest_name: 'Jane Doe',
	guest_email: 'jane@example.com',
	guest_answers: JSON.stringify([
		{ id: 'notes', label: 'Anything else?', type: 'paragraph', value: 'Looking forward to it' }
	]),
	guest_timezone: 'America/Los_Angeles',
	location: 'Zoom',
	status: 'confirmed',
	note: null,
	cancel_token: 'tok-1',
	action_log: null,
	external_event_id: null,
	external_calendar_id: null,
	calendar_revision: 0,
	calendar_synced_revision: null,
	has_possible_conflict: 0,
	ics_sequence: 0,
	event_type_snapshot: null,
	created_at: '2026-01-01T09:00:00Z',
	updated_at: '2026-01-01T09:00:00Z',
	origin_id: null
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

export const sampleLinks: AppointmentLinks = {
	booked: 'https://when.example.com/appointment/appt-1',
	reschedule: 'https://when.example.com/schedule/30-min',
	manage: 'https://when.example.com/signin'
};

export const sampleInput: AppointmentEmailInput = {
	cfg: sampleConfig,
	appointment: sampleAppointment,
	eventType: undefined,
	links: sampleLinks,
	logo: null
};
