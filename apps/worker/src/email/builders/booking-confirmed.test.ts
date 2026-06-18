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

	test('organizer message: new-booking content, answer rows, no ics', () => {
		const [, organizer] = bookingConfirmed(sampleInput);

		expect(organizer?.to).toBe('owner@acme.test');
		expect(organizer?.content.subject).toBe('New booking: 30-min with Jane Doe');
		expect(organizer?.content.heading).toBe('New booking');
		expect(organizer?.content.paragraphs).toContain('Jane Doe <jane@example.com> just booked.');
		expect(organizer?.content.rows).toContainEqual({
			label: 'Anything else?',
			value: 'Looking forward to it'
		});
		expect(organizer?.content.actions).toEqual([]);
		expect(organizer?.ics).toBeUndefined();
	});

	test('no attendee message and no email line when the booking has no email', () => {
		const noEmail = {
			...sampleInput,
			appointment: { ...sampleInput.appointment, attendee_email: null }
		};
		const [attendee, organizer] = bookingConfirmed(noEmail);

		expect(attendee).toBeNull();
		expect(organizer?.content.paragraphs).toContain('Jane Doe just booked.');
	});

	test('each recipient sees the time in their own zone', () => {
		const [attendee, organizer] = bookingConfirmed(sampleInput);
		const whenOf = (m: typeof attendee) => m.content.rows.find((r) => r.label === 'When')?.value;

		// fixture: attendee in America/Los_Angeles, organizer in America/New_York
		expect(whenOf(attendee)).not.toBe(whenOf(organizer));
		expect(whenOf(attendee)).toContain('GMT-8');
		expect(whenOf(organizer)).toContain('GMT-5');
	});
});
