import { expect, test } from 'vitest';
import { bookingRescheduledByOrganizer } from './booking-rescheduled-by-organizer';
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
	status: 'confirmed',
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

test('bookingRescheduledByOrganizer: attendee envelope has links and a REQUEST ICS', () => {
	const [attendee] = bookingRescheduledByOrganizer(input);

	expect(attendee.to).toBe('booker@example.com');
	expect(attendee.subject).toBe('Rescheduled: 30 Minute Chat with Jane Doe');
	expect(attendee.html).toContain('Jane Doe moved this booking to a new time.');
	expect(attendee.html).toContain('token=tok&amp;cancel=1');
	expect(attendee.text).toContain(
		'Reschedule: https://when.example.com/schedule/30-min?reschedule=appt-1&token=tok'
	);

	expect(attendee.attachments).toHaveLength(1);
	expect(attendee.attachments![0].content).toContain('METHOD:REQUEST');
});

test('bookingRescheduledByOrganizer: organizer envelope notified of the reschedule, no ICS', () => {
	const [, admin] = bookingRescheduledByOrganizer(input);

	expect(admin.to).toBe(validConfig.user.email);
	expect(admin.subject).toBe('Rescheduled: 30 Minute Chat with Booker');
	expect(admin.html).toContain(
		'You rescheduled Booker &lt;booker@example.com> booking for 30 Minute Chat.'
	);
	expect(admin.text).toContain(
		'You rescheduled Booker <booker@example.com> booking for 30 Minute Chat.'
	);
	expect(admin.attachments).toBeUndefined();
});
