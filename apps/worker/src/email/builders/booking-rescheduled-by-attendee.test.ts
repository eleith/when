import { describe, expect, test } from 'vitest';
import { bookingRescheduledByAttendee } from './booking-rescheduled-by-attendee.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingRescheduledByAttendee', () => {
	test('attendee (with REQUEST ics) + organizer envelopes', async () => {
		const [attendee, organizer] = await bookingRescheduledByAttendee(sampleInput);

		expect(attendee.subject).toBe('Rescheduled: 30-min with Acme Scheduling');
		expect(attendee.html ?? '').toContain('moved to a new time');
		expect(attendee.text).toContain(`View this booking: ${sampleInput.links.booked}`);
		expect(attendee.attachments?.[0].content).toContain('METHOD:REQUEST');

		expect(organizer.to).toBe('owner@acme.test');
		expect(organizer.text).toContain('Jane Doe <jane@example.com> rescheduled this booking.');
		expect(organizer.attachments).toBeUndefined();
	});
});
