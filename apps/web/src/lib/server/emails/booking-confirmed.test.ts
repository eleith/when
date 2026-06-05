import { expect, test } from 'vitest';
import { bookingConfirmed } from './booking-confirmed';
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
	ics_sequence: 0,
	created_at: '',
	updated_at: ''
};

const input = {
	cfg: validConfig,
	appointment,
	eventType: validConfig.event_types[0],
	baseUrl: 'https://when.example.com'
};

test('bookingConfirmed: attendee envelope has the confirmation, links, and a REQUEST ICS', () => {
	const [attendee] = bookingConfirmed(input);

	expect(attendee.to).toBe('booker@example.com');
	expect(attendee.subject).toContain('Confirmed');
	expect(attendee.subject).toContain('30 Minute Chat');

	expect(attendee.html).toContain('<!DOCTYPE html');
	expect(attendee.html).toContain('Your booking is confirmed.');
	// cancel link rendered in an href (Svelte escapes the &)
	expect(attendee.html).toContain('token=tok&amp;cancel=1');
	expect(attendee.html).not.toContain('<!--');

	expect(attendee.text).toContain(
		'Cancel: https://when.example.com/booked/appt-1?token=tok&cancel=1'
	);
	expect(attendee.text).toContain(
		'Reschedule: https://when.example.com/schedule/30-min?reschedule=appt-1&token=tok'
	);

	expect(attendee.attachments).toHaveLength(1);
	expect(attendee.attachments![0].content).toContain('METHOD:REQUEST');
});

test('bookingConfirmed: organizer envelope names the attendee, no ICS', () => {
	const [, admin] = bookingConfirmed(input);

	expect(admin.to).toBe(validConfig.user.email);
	expect(admin.subject).toContain('New booking');
	expect(admin.html).toContain('Booker');
	expect(admin.html).toContain('booker@example.com');
	expect(admin.attachments).toBeUndefined();
});
