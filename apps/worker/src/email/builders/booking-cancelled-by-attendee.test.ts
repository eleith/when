import { describe, expect, test } from 'vitest';
import { bookingCancelledByAttendee } from './booking-cancelled-by-attendee.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingCancelledByAttendee', () => {
	test('attendee (CANCEL ics) + organizer messages', () => {
		const [attendee, organizer] = bookingCancelledByAttendee(sampleInput);

		expect(attendee.to).toBe('jane@example.com');
		expect(attendee.content.subject).toBe('Cancelled: 30-min with Acme Scheduling');
		expect(attendee.content.heading).toBe('Your booking has been cancelled.');
		expect(attendee.content.rows).toEqual([
			{ label: 'What', value: '30-min' },
			{ label: 'When', value: expect.any(String) }
		]);
		expect(attendee.ics?.content).toContain('METHOD:CANCEL');

		expect(organizer.to).toBe('owner@acme.test');
		expect(organizer.content.subject).toBe('Cancelled: 30-min with Jane Doe');
		expect(organizer.content.paragraphs).toContain(
			'Jane Doe <jane@example.com> cancelled this booking.'
		);
		expect(organizer.ics).toBeUndefined();
	});
});
