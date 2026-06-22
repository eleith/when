import { describe, expect, test } from 'vitest';
import { appointmentRescheduledByHost } from './appointment-rescheduled-by-host.js';
import { sampleInput } from '../__fixtures__/appointment.js';

describe('appointmentRescheduledByHost', () => {
	test('guest (named by host, REQUEST ics) + host messages', () => {
		const [guest, host] = appointmentRescheduledByHost(sampleInput);

		expect(guest.content.heading).toBe('Acme Scheduling moved this appointment to a new time.');
		expect(guest.content.actions).toEqual([
			{ href: sampleInput.links.booked, label: 'View this appointment', variant: 'primary' }
		]);
		expect(guest.ics?.content).toContain('METHOD:REQUEST');

		expect(host.to).toBe('owner@acme.test');
		expect(host.content.subject).toBe('Rescheduled: 30-min with Jane Doe');
		expect(host.content.heading).toBe('Appointment rescheduled');
		expect(host.content.paragraphs).toContain(
			'You rescheduled the appointment for Jane Doe <jane@example.com>.'
		);
		expect(host.ics).toBeUndefined();
	});

	test('moving a still-pending request: proposed-time copy, no guest ics', () => {
		const input = {
			...sampleInput,
			appointment: { ...sampleInput.appointment, status: 'pending' as const }
		};
		const [guest, host] = appointmentRescheduledByHost(input);

		expect(guest.content.heading).toBe('Acme Scheduling proposed a new time for your request.');
		expect(guest.ics).toBeUndefined();
		expect(host.content.paragraphs).toContain(
			'You moved the pending request for Jane Doe <jane@example.com> to a new time.'
		);
	});
});
