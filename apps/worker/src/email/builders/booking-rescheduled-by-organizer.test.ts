import { describe, expect, test } from 'vitest';
import { bookingRescheduledByOrganizer } from './booking-rescheduled-by-organizer.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingRescheduledByOrganizer', () => {
	test('attendee (named by organizer, with REQUEST ics) + organizer envelopes', async () => {
		const [attendee, organizer] = await bookingRescheduledByOrganizer(sampleInput);

		expect(attendee.html ?? '').toContain('Acme Scheduling moved this booking to a new time');
		expect(attendee.text).toContain('Acme Scheduling moved this booking to a new time.');
		expect(attendee.attachments?.[0].content).toContain('METHOD:REQUEST');

		expect(organizer.subject).toBe('Rescheduled: 30-min with Jane Doe');
		expect(organizer.text).toContain(
			'You rescheduled the booking for Jane Doe <jane@example.com>.'
		);
		expect(organizer.attachments).toBeUndefined();
	});
});
