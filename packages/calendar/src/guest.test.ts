import { expect, test } from 'vitest';
import { attendeeGuest } from './guest.js';

test('returns the email/name guest when an email was collected', () => {
	expect(attendeeGuest({ attendee_name: 'Booker', attendee_email: 'b@example.com' })).toEqual({
		email: 'b@example.com',
		name: 'Booker'
	});
});

test('returns null when there is no email', () => {
	expect(attendeeGuest({ attendee_name: 'Booker', attendee_email: null })).toBeNull();
});
