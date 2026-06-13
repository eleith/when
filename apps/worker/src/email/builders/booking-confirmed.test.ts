import { describe, expect, test } from 'vitest';
import { bookingConfirmed } from './booking-confirmed.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingConfirmed', () => {
	test('attendee message: confirmed content, View CTA, REQUEST ics', () => {
		const [attendee] = bookingConfirmed(sampleInput);

		expect(attendee.to).toBe('jane@example.com');
		expect(attendee.content.subject).toBe('Confirmed: 30-min with Acme Scheduling');
		expect(attendee.content.heading).toBe('Your booking is confirmed.');
		expect(attendee.content.rows).toEqual([
			{ label: 'What', value: '30-min' },
			{ label: 'When', value: expect.any(String) },
			{ label: 'Where', value: 'Zoom' }
		]);
		expect(attendee.content.actions).toEqual([
			{ href: sampleInput.links.booked, label: 'View this booking', variant: 'primary' }
		]);
		expect(attendee.ics?.content).toContain('METHOD:REQUEST');
	});

	test('organizer message: new-booking content, notes row, no ics', () => {
		const [, organizer] = bookingConfirmed(sampleInput);

		expect(organizer.to).toBe('owner@acme.test');
		expect(organizer.content.subject).toBe('New booking: 30-min with Jane Doe');
		expect(organizer.content.heading).toBe('New booking');
		expect(organizer.content.paragraphs).toContain('Jane Doe <jane@example.com> just booked.');
		expect(organizer.content.rows).toContainEqual({
			label: 'Notes',
			value: 'Looking forward to it'
		});
		expect(organizer.content.actions).toEqual([]);
		expect(organizer.ics).toBeUndefined();
	});
});
