import { describe, expect, test } from 'vitest';
import { bookingDeclined } from './booking-declined.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingDeclined', () => {
	test('attendee + organizer messages, no ics', () => {
		const [attendee, organizer] = bookingDeclined(sampleInput);

		expect(attendee.to).toBe('jane@example.com');
		expect(attendee.content.subject).toBe('Declined: 30-min with Acme Scheduling');
		expect(attendee.content.heading).toBe('Your appointment request was declined.');
		expect(attendee.ics).toBeUndefined();

		expect(organizer.content.subject).toBe('Declined: 30-min from Jane Doe');
		expect(organizer.content.paragraphs).toContain(
			'You declined the request from Jane Doe <jane@example.com>.'
		);
		expect(organizer.ics).toBeUndefined();
	});
});
