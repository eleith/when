import { describe, expect, test } from 'vitest';
import { bookingDeclined } from './booking-declined.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingDeclined', () => {
	test('attendee + organizer envelopes, no ics', async () => {
		const [attendee, organizer] = await bookingDeclined(sampleInput);

		expect(attendee.to).toBe('jane@example.com');
		expect(attendee.subject).toBe('Declined: 30-min with Acme Scheduling');
		expect(attendee.html ?? '').toContain('Your booking request was declined');
		expect(attendee.text).toContain('Your booking request was declined.');
		expect(attendee.attachments).toBeUndefined();

		expect(organizer.subject).toBe('Declined: 30-min from Jane Doe');
		expect(organizer.text).toContain(
			"You declined Jane Doe's <jane@example.com> request for 30-min."
		);
		expect(organizer.attachments).toBeUndefined();
	});
});
