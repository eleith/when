import { describe, expect, test } from 'vitest';
import { bookingPendingToAttendee } from './booking-pending-to-attendee.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingPendingToAttendee', () => {
	test('a single attendee envelope, no ics', async () => {
		const envelopes = await bookingPendingToAttendee(sampleInput);
		expect(envelopes).toHaveLength(1);
		const [attendee] = envelopes;

		expect(attendee.to).toBe('jane@example.com');
		expect(attendee.subject).toBe('Booking request received: 30-min with Acme Scheduling');
		expect(attendee.html ?? '').toContain('Booking request received: 30-min');
		expect(attendee.html ?? '').toContain('jane@example.com'); // attendee email in the body
		expect(attendee.text).toContain('Thanks — we got your request to book 30-min.');
		expect(attendee.text).toContain('Need to change something before then?');
		expect(attendee.attachments).toBeUndefined();
	});
});
