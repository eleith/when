import { expect, test } from 'vitest';
import { bookingCancelledByOrganizer } from './booking-cancelled-by-organizer';
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
	email_notification_status: null,
	calendar_push_notification_status: null,
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

test('bookingCancelledByOrganizer: attendee envelope has CANCEL ICS', () => {
	const [attendee] = bookingCancelledByOrganizer(input);

	expect(attendee.to).toBe('booker@example.com');
	expect(attendee.subject).toBe('Cancelled: 30 Minute Chat with Jane Doe');
	expect(attendee.html).toContain('Jane Doe cancelled this booking.');
	expect(attendee.text).toContain('Jane Doe cancelled this booking.');

	expect(attendee.attachments).toHaveLength(1);
	expect(attendee.attachments![0].content).toContain('METHOD:CANCEL');
});

test('bookingCancelledByOrganizer: organizer envelope notified of the cancellation, no ICS', () => {
	const [, admin] = bookingCancelledByOrganizer(input);

	expect(admin.to).toBe(validConfig.user.email);
	expect(admin.subject).toBe('Cancelled: 30 Minute Chat with Booker');
	expect(admin.html).toContain(
		'You cancelled Booker &lt;booker@example.com> booking for 30 Minute Chat.'
	);
	expect(admin.text).toContain(
		'You cancelled Booker <booker@example.com> booking for 30 Minute Chat.'
	);
	expect(admin.attachments).toBeUndefined();
});
