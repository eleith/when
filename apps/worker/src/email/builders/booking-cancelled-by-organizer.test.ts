import { describe, expect, test } from 'vitest';
import { bookingCancelledByOrganizer } from './booking-cancelled-by-organizer.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingCancelledByOrganizer', () => {
	test('attendee (named by organizer, with CANCEL ics) + organizer envelopes', async () => {
		const [attendee, organizer] = await bookingCancelledByOrganizer(sampleInput);

		expect(attendee.to).toBe('jane@example.com');
		expect(attendee.subject).toBe('Cancelled: 30-min with Acme Scheduling');
		expect(attendee.html ?? '').toContain('Acme Scheduling cancelled this booking');
		expect(attendee.text).toContain('Acme Scheduling cancelled this booking.');
		expect(attendee.attachments?.[0].content).toContain('METHOD:CANCEL');

		expect(organizer.subject).toBe('Cancelled: 30-min with Jane Doe');
		expect(organizer.text).toContain('You cancelled the booking for Jane Doe <jane@example.com>.');
		expect(organizer.attachments).toBeUndefined();
	});
});
