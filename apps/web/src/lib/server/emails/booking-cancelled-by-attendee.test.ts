import { expect, test } from 'vitest';
import { bookingCancelledByAttendee } from './booking-cancelled-by-attendee';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import type { Appointment } from '@when/db';

const appointment: Appointment = {
	id: 'appt-1',
	event_type_id: '30-min-chat',
	start_time: '2026-04-27T13:00:00Z',
	end_time: '2026-04-27T13:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_notes: null,
	location: 'Online',
	status: 'cancelled',
	cancel_token: 'tok',
	external_event_id: null,
	external_calendar_id: null,
	notification_status: null,
	ics_sequence: 1,
	created_at: '',
	updated_at: ''
};

const input = {
	cfg: validConfig,
	appointment,
	eventType: validConfig.event_types[0],
	baseUrl: 'https://when.example.com'
};

test('bookingCancelledByAttendee: attendee envelope has CANCEL ICS', () => {
	const [attendee] = bookingCancelledByAttendee(input);

	expect(attendee.to).toBe('booker@example.com');
	expect(attendee.subject).toBe('Cancelled: 30 Minute Chat with Jane Doe');
	expect(attendee.html).toContain('Your booking has been cancelled.');
	expect(attendee.text).toContain('Your booking has been cancelled.');

	expect(attendee.attachments).toHaveLength(1);
	expect(attendee.attachments![0].content).toContain('METHOD:CANCEL');
});

test('bookingCancelledByAttendee: organizer envelope notified of the cancellation, no ICS', () => {
	const [, admin] = bookingCancelledByAttendee(input);

	expect(admin.to).toBe(validConfig.user.email);
	expect(admin.subject).toBe('Cancelled: 30 Minute Chat with Booker');
	expect(admin.html).toContain('Booker &lt;booker@example.com> cancelled 30 Minute Chat.');
	expect(admin.text).toContain('Booker <booker@example.com> cancelled 30 Minute Chat.');
	expect(admin.attachments).toBeUndefined();
});
