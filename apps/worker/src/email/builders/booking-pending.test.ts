import { describe, expect, test } from 'vitest';
import type { EventType } from '@when/config';
import { bookingPending } from './booking-pending.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingPending', () => {
	test('attendee (request received) + organizer (review request), no ics', () => {
		const withType = {
			...sampleInput,
			eventType: { name: '30 Minute Chat', duration: 30 } as EventType
		};
		const [attendee, organizer] = bookingPending(withType);

		expect(attendee.to).toBe('jane@example.com');
		expect(attendee.subject).toBe('Booking request received: 30 Minute Chat with Acme Scheduling');
		expect(attendee.html ?? '').toContain('Booking request received: 30 Minute Chat');
		expect(attendee.text).toContain(
			'Acme Scheduling will review your request and email you to confirm.'
		);
		expect(attendee.attachments).toBeUndefined();

		expect(organizer.to).toBe('owner@acme.test');
		expect(organizer.subject).toBe('Booking request: 30 Minute Chat from Jane Doe');
		expect(organizer.html ?? '').toContain(sampleInput.links.manage);
		expect(organizer.text).toContain(`Review request: ${sampleInput.links.manage}`);
		expect(organizer.attachments).toBeUndefined();
	});
});
