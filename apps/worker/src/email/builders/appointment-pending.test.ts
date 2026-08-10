import { describe, expect, test } from 'vitest';
import type { Meeting } from '@when/config';
import { appointmentPending } from './appointment-pending.js';
import { sampleInput } from '../__fixtures__/appointment.js';

describe('appointmentPending', () => {
	test('guest (request received) + host (review request), no ics', () => {
		const withType = {
			...sampleInput,
			eventType: { title: '30 Minute Chat', duration_minutes: 30 } as Meeting
		};
		const [guest, host] = appointmentPending(withType);

		expect(guest.to).toBe('jane@example.com');
		expect(guest.content.subject).toBe(
			'Appointment request received: 30 Minute Chat with Acme Scheduling'
		);
		expect(guest.content.heading).toBe('Your appointment request was received.');
		expect(guest.content.paragraphs).toContain(
			'Acme Scheduling will review your request and email you to confirm.'
		);
		expect(guest.content.actions).toEqual([
			{ href: sampleInput.links.booked, label: 'View this appointment' }
		]);
		expect(guest.ics).toBeUndefined();

		expect(host.to).toBe('owner@acme.test');
		expect(host.content.subject).toBe('Appointment request: 30 Minute Chat from Jane Doe');
		expect(host.content.heading).toBe('New appointment request');
		expect(host.content.actions).toEqual([
			{ href: sampleInput.links.manage, label: 'Review request' }
		]);
		expect(host.ics).toBeUndefined();
	});
});
