import { describe, expect, test } from 'vitest';
import { appointmentRescheduledByGuest } from './appointment-rescheduled-by-guest.js';
import { sampleInput } from '../__fixtures__/appointment.js';

describe('appointmentRescheduledByGuest', () => {
	test('guest (REQUEST ics) + host messages', () => {
		const [guest, host] = appointmentRescheduledByGuest(sampleInput);

		expect(guest.to).toBe('jane@example.com');
		expect(guest.content.subject).toBe('Rescheduled: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Your appointment moved to a new time.');
		expect(guest.content.actions).toEqual([
			{ href: sampleInput.links.booked, label: 'View this appointment', variant: 'primary' }
		]);
		expect(guest.ics?.content).toContain('METHOD:REQUEST');

		expect(host.to).toBe('owner@acme.test');
		expect(host.content.heading).toBe('Appointment rescheduled');
		expect(host.content.paragraphs).toContain(
			'Jane Doe <jane@example.com> rescheduled this appointment.'
		);
		expect(host.ics).toBeUndefined();
	});

	test('pending re-approval: request copy, no guest ics, host review action', () => {
		const input = {
			...sampleInput,
			appointment: { ...sampleInput.appointment, status: 'pending' as const }
		};
		const [guest, host] = appointmentRescheduledByGuest(input);

		expect(guest.content.heading).toBe('Your reschedule request was received.');
		expect(guest.ics).toBeUndefined();
		expect(host.content.heading).toBe('Reschedule request');
		expect(host.content.actions).toEqual([
			{ href: input.links.manage, label: 'Review request', variant: 'primary' }
		]);
	});
});
