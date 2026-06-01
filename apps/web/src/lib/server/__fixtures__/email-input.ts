import type { Appointment } from '@when/db';
import type { BookingEmailInput } from '$lib/server/email/types';
import { validConfig } from './valid-config';

export const sampleAppointment: Appointment = {
	id: 'appt-1',
	event_type_id: '30-min-chat',
	start_time: '2026-04-27T13:00:00Z',
	end_time: '2026-04-27T13:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_notes: null,
	location: 'Online',
	status: 'confirmed',
	cancel_token: 'tok',
	external_event_id: null,
	external_calendar_id: null,
	notification_status: null,
	ics_sequence: 0,
	created_at: '',
	updated_at: ''
};

export const sampleEmailInput: BookingEmailInput = {
	cfg: validConfig,
	appointment: sampleAppointment,
	eventType: validConfig.event_types[0],
	baseUrl: 'https://when.example.com'
};
