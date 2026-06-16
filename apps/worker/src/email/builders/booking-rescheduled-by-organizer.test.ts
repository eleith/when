import { describe, expect, test } from 'vitest';
import { bookingRescheduledByOrganizer } from './booking-rescheduled-by-organizer.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingRescheduledByOrganizer', () => {
	test('attendee (named by organizer, REQUEST ics) + organizer messages', () => {
		const [attendee, organizer] = bookingRescheduledByOrganizer(sampleInput);

		expect(attendee.content.heading).toBe('Acme Scheduling moved this booking to a new time.');
		expect(attendee.content.actions).toEqual([
			{ href: sampleInput.links.booked, label: 'View this booking', variant: 'primary' }
		]);
		expect(attendee.ics?.content).toContain('METHOD:REQUEST');

		expect(organizer.to).toBe('owner@acme.test');
		expect(organizer.content.subject).toBe('Rescheduled: 30-min with Jane Doe');
		expect(organizer.content.heading).toBe('Booking rescheduled');
		expect(organizer.content.paragraphs).toContain(
			'You rescheduled the booking for Jane Doe <jane@example.com>.'
		);
		expect(organizer.ics).toBeUndefined();
	});

	test('moving a still-pending request: proposed-time copy, no attendee ics', () => {
		const input = {
			...sampleInput,
			appointment: { ...sampleInput.appointment, status: 'pending' as const }
		};
		const [attendee, organizer] = bookingRescheduledByOrganizer(input);

		expect(attendee.content.heading).toBe('Acme Scheduling proposed a new time for your request.');
		expect(attendee.ics).toBeUndefined();
		expect(organizer.content.paragraphs).toContain(
			'You moved the pending request for Jane Doe <jane@example.com> to a new time.'
		);
	});
});
