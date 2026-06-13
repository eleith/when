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
		expect(attendee.content.subject).toBe(
			'Booking request received: 30 Minute Chat with Acme Scheduling'
		);
		expect(attendee.content.heading).toBe('Your booking request was received.');
		expect(attendee.content.paragraphs).toContain(
			'Acme Scheduling will review your request and email you to confirm.'
		);
		expect(attendee.content.actions).toEqual([
			{ href: sampleInput.links.booked, label: 'View this booking', variant: 'primary' }
		]);
		expect(attendee.ics).toBeUndefined();

		expect(organizer.to).toBe('owner@acme.test');
		expect(organizer.content.subject).toBe('Booking request: 30 Minute Chat from Jane Doe');
		expect(organizer.content.heading).toBe('New booking request');
		expect(organizer.content.actions).toEqual([
			{ href: sampleInput.links.manage, label: 'Review request', variant: 'primary' }
		]);
		expect(organizer.ics).toBeUndefined();
	});
});
