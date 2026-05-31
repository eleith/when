import { expect, test } from 'vitest';
import { bookingPendingToAttendee } from './booking-pending-to-attendee';
import { sampleEmailInput } from '$lib/server/__fixtures__/email-input';

test('bookingPendingToAttendee: acknowledges the request to the attendee, no ICS', () => {
	const [attendee, ...rest] = bookingPendingToAttendee(sampleEmailInput);

	expect(rest).toHaveLength(0);
	expect(attendee.to).toBe('booker@example.com');
	expect(attendee.subject).toContain('Booking request received');
	expect(attendee.html).toContain('Booking request received: 30 Minute Chat');
	expect(attendee.html).toContain('token=tok&amp;cancel=1');
	expect(attendee.text).toContain(
		'Cancel: https://when.example.com/booked/appt-1?token=tok&cancel=1'
	);
	expect(attendee.attachments).toBeUndefined();
});
