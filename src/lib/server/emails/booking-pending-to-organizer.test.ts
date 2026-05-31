import { expect, test } from 'vitest';
import { bookingPendingToOrganizer } from './booking-pending-to-organizer';
import { sampleEmailInput } from '$lib/server/__fixtures__/email-input';

test('bookingPendingToOrganizer: notifies the organizer with a review link, no ICS', () => {
	const [organizer, ...rest] = bookingPendingToOrganizer(sampleEmailInput);

	expect(rest).toHaveLength(0);
	expect(organizer.to).toBe(sampleEmailInput.cfg.user.email);
	expect(organizer.subject).toContain('Booking request');
	expect(organizer.subject).toContain('Booker');
	expect(organizer.html).toContain('Review request');
	expect(organizer.html).toContain('/signin?callbackUrl=%2Fbooked%2Fappt-1');
	expect(organizer.text).toContain(
		'Review request: https://when.example.com/signin?callbackUrl=%2Fbooked%2Fappt-1'
	);
	expect(organizer.attachments).toBeUndefined();
});
