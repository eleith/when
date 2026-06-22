import { describe, expect, test } from 'vitest';
import { appointmentConfirmed } from './appointment-confirmed.js';
import { sampleInput } from '../__fixtures__/appointment.js';

describe('appointmentConfirmed', () => {
	test('guest message: confirmed content, View CTA, REQUEST ics', () => {
		const [guest] = appointmentConfirmed(sampleInput);

		expect(guest.to).toBe('jane@example.com');
		expect(guest.content.subject).toBe('Confirmed: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Your appointment is confirmed.');
		expect(guest.content.rows).toEqual([
			{ label: 'What', value: '30-min' },
			{ label: 'When', value: expect.any(String) },
			{ label: 'Where', value: 'Zoom' }
		]);
		expect(guest.content.actions).toEqual([
			{ href: sampleInput.links.booked, label: 'View this appointment', variant: 'primary' }
		]);
		expect(guest.ics?.content).toContain('METHOD:REQUEST');
	});

	test('host message: new-appointment content, answer rows, no ics', () => {
		const [, host] = appointmentConfirmed(sampleInput);

		expect(host?.to).toBe('owner@acme.test');
		expect(host?.content.subject).toBe('New appointment: 30-min with Jane Doe');
		expect(host?.content.heading).toBe('New appointment');
		expect(host?.content.paragraphs).toContain(
			'Jane Doe <jane@example.com> just scheduled an appointment.'
		);
		expect(host?.content.rows).toContainEqual({
			label: 'Anything else?',
			value: 'Looking forward to it'
		});
		expect(host?.content.actions).toEqual([]);
		expect(host?.ics).toBeUndefined();
	});

	test('no guest message and no email line when the appointment has no email', () => {
		const noEmail = {
			...sampleInput,
			appointment: { ...sampleInput.appointment, guest_email: null }
		};
		const result = appointmentConfirmed(noEmail);

		expect(result).toHaveLength(1);
		expect(result[0].to).toBe('owner@acme.test');
		expect(result[0].content.paragraphs).toContain('Jane Doe just scheduled an appointment.');
	});

	test('each recipient sees the time in their own zone', () => {
		const [guest, host] = appointmentConfirmed(sampleInput);
		const whenOf = (m: typeof guest) => m.content.rows.find((r) => r.label === 'When')?.value;

		// fixture: guest in America/Los_Angeles, host in America/New_York
		expect(whenOf(guest)).not.toBe(whenOf(host));
		expect(whenOf(guest)).toContain('GMT-8');
		expect(whenOf(host)).toContain('GMT-5');
	});
});
