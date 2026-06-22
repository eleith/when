import { expect, test } from 'vitest';
import { guestContact } from './guest.js';

test('returns the email/name guest when an email was collected', () => {
	expect(guestContact({ guest_name: 'Booker', guest_email: 'b@example.com' })).toEqual({
		email: 'b@example.com',
		name: 'Booker'
	});
});

test('returns null when there is no email', () => {
	expect(guestContact({ guest_name: 'Booker', guest_email: null })).toBeNull();
});
