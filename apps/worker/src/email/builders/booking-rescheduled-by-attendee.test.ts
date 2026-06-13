import { describe, expect, test } from 'vitest';
import { bookingRescheduledByAttendee } from './booking-rescheduled-by-attendee.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingRescheduledByAttendee', () => {
	test('attendee (REQUEST ics) + organizer messages', () => {
		const [attendee, organizer] = bookingRescheduledByAttendee(sampleInput);

		expect(attendee.to).toBe('jane@example.com');
		expect(attendee.content.subject).toBe('Rescheduled: 30-min with Acme Scheduling');
		expect(attendee.content.heading).toBe('Your booking moved to a new time.');
		expect(attendee.content.actions).toEqual([
			{ href: sampleInput.links.booked, label: 'View this booking', variant: 'primary' }
		]);
		expect(attendee.ics?.content).toContain('METHOD:REQUEST');

		expect(organizer.to).toBe('owner@acme.test');
		expect(organizer.content.heading).toBe('Booking rescheduled');
		expect(organizer.content.paragraphs).toContain(
			'Jane Doe <jane@example.com> rescheduled this booking.'
		);
		expect(organizer.ics).toBeUndefined();
	});
});
