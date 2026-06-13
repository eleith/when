import { describe, expect, test } from 'vitest';
import { bookingCancelledByOrganizer } from './booking-cancelled-by-organizer.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingCancelledByOrganizer', () => {
	test('attendee (named by organizer, CANCEL ics) + organizer messages', () => {
		const [attendee, organizer] = bookingCancelledByOrganizer(sampleInput);

		expect(attendee.to).toBe('jane@example.com');
		expect(attendee.content.subject).toBe('Cancelled: 30-min with Acme Scheduling');
		expect(attendee.content.heading).toBe('Acme Scheduling cancelled this booking.');
		expect(attendee.ics?.content).toContain('METHOD:CANCEL');

		expect(organizer.content.subject).toBe('Cancelled: 30-min with Jane Doe');
		expect(organizer.content.paragraphs).toContain(
			'You cancelled the booking for Jane Doe <jane@example.com>.'
		);
		expect(organizer.ics).toBeUndefined();
	});
});
