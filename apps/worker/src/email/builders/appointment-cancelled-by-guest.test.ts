import { describe, expect, test } from 'vitest';
import { appointmentCancelledByGuest } from './appointment-cancelled-by-guest.js';
import { sampleAppointment, sampleInput } from '../__fixtures__/appointment.js';

describe('appointmentCancelledByGuest', () => {
	test('guest (CANCEL ics) + host messages', () => {
		const [guest, host] = appointmentCancelledByGuest(sampleInput);

		expect(guest.to).toBe('jane@example.com');
		expect(guest.content.subject).toBe('Cancelled: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Your appointment has been cancelled.');
		expect(guest.content.rows).toEqual([
			{ label: 'What', value: '30-min' },
			{ label: 'When', value: expect.any(String) }
		]);
		expect(guest.ics?.content).toContain('METHOD:CANCEL');

		expect(host.to).toBe('owner@acme.test');
		expect(host.content.subject).toBe('Cancelled: 30-min with Jane Doe');
		expect(host.content.paragraphs).toContain(
			'Jane Doe <jane@example.com> cancelled this appointment.'
		);
		expect(host.ics).toBeUndefined();
	});

	test('includes cancel reason in both messages when present', () => {
		const input = {
			...sampleInput,
			appointment: {
				...sampleAppointment,
				action_log: JSON.stringify([
					{
						action: 'cancel',
						actor: 'guest',
						at: '2026-01-01T12:00:00Z',
						payload: { note: 'Double booked' }
					}
				])
			}
		};
		const [guest, host] = appointmentCancelledByGuest(input);

		expect(guest.content.paragraphs).toEqual(['Reason: Double booked']);
		expect(host.content.paragraphs).toEqual([
			'Jane Doe <jane@example.com> cancelled this appointment.',
			'Reason: Double booked'
		]);
	});

	test('no reason paragraph when action_log is null', () => {
		const [guest, host] = appointmentCancelledByGuest(sampleInput);

		expect(guest.content.paragraphs).toEqual([]);
		expect(host.content.paragraphs).toEqual([
			'Jane Doe <jane@example.com> cancelled this appointment.'
		]);
	});
});
