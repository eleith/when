import { describe, expect, test } from 'vitest';
import { bookingCancelledByAttendee } from './booking-cancelled-by-attendee.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingCancelledByAttendee', () => {
	test('attendee (with CANCEL ics) + organizer envelopes', async () => {
		const [attendee, organizer] = await bookingCancelledByAttendee(sampleInput);

		expect(attendee.to).toBe('jane@example.com');
		expect(attendee.subject).toBe('Cancelled: 30-min with Acme Scheduling');
		expect(attendee.html ?? '').toContain('Your booking has been cancelled');
		expect(attendee.text).toMatch(
			/^Acme Scheduling\n\nYour booking has been cancelled\.\n\nWhat: 30-min\nWhen: /
		);
		expect(attendee.attachments?.[0].content).toContain('METHOD:CANCEL');

		expect(organizer.to).toBe('owner@acme.test');
		expect(organizer.subject).toBe('Cancelled: 30-min with Jane Doe');
		expect(organizer.text).toContain('Jane Doe <jane@example.com> cancelled this booking.');
		expect(organizer.attachments).toBeUndefined();
	});
});
