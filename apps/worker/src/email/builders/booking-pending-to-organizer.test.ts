import { describe, expect, test } from 'vitest';
import { bookingPendingToOrganizer } from './booking-pending-to-organizer.js';
import { sampleInput } from '../__fixtures__/booking.js';
import type { EventType } from '@when/config';

describe('bookingPendingToOrganizer', () => {
	test('a single organizer envelope with a Review request button and duration', async () => {
		const withType = {
			...sampleInput,
			eventType: { name: '30 Minute Chat', duration: 30 } as EventType
		};
		const [organizer] = await bookingPendingToOrganizer(withType);

		expect(organizer.to).toBe('owner@acme.test');
		expect(organizer.subject).toBe('Booking request: 30 Minute Chat from Jane Doe');
		expect(organizer.html ?? '').toContain(sampleInput.links.manage); // review button href
		expect(organizer.text).toContain('Jane Doe <jane@example.com> has requested to book');
		expect(organizer.text).toContain('Duration: 30 min');
		expect(organizer.text).toContain(`Review request: ${sampleInput.links.manage}`);
		expect(organizer.attachments).toBeUndefined();
	});
});
