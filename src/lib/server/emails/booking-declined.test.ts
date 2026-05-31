import { expect, test } from 'vitest';
import { bookingDeclined } from './booking-declined';
import { sampleEmailInput } from '$lib/server/__fixtures__/email-input';

test('bookingDeclined: tells the attendee and the organizer, no ICS', () => {
	const [attendee, admin] = bookingDeclined(sampleEmailInput);

	expect(attendee.to).toBe('booker@example.com');
	expect(attendee.subject).toContain('Declined');
	expect(attendee.html).toContain('Your booking request was declined.');
	expect(attendee.attachments).toBeUndefined();

	expect(admin.to).toBe(sampleEmailInput.cfg.user.email);
	expect(admin.subject).toContain('Declined');
	expect(admin.html).toContain('You declined');
	expect(admin.text).toContain('You declined');
});
