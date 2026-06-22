import { describe, expect, test } from 'vitest';
import { appointmentCancelledByHost } from './appointment-cancelled-by-host.js';
import { sampleAppointment, sampleInput } from '../__fixtures__/appointment.js';

describe('appointmentCancelledByHost', () => {
	test('guest (named by host, CANCEL ics) + host messages', () => {
		const [guest, host] = appointmentCancelledByHost(sampleInput);

		expect(guest.to).toBe('jane@example.com');
		expect(guest.content.subject).toBe('Cancelled: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Acme Scheduling cancelled this appointment.');
		expect(guest.ics?.content).toContain('METHOD:CANCEL');

		expect(host.content.subject).toBe('Cancelled: 30-min with Jane Doe');
		expect(host.content.paragraphs).toContain(
			'You cancelled the appointment for Jane Doe <jane@example.com>.'
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
						actor: 'host',
						at: '2026-01-01T12:00:00Z',
						payload: { note: 'No longer needed' }
					}
				])
			}
		};
		const [guest, host] = appointmentCancelledByHost(input);

		expect(guest.content.paragraphs).toEqual(['Reason: No longer needed']);
		expect(host.content.paragraphs).toEqual([
			'You cancelled the appointment for Jane Doe <jane@example.com>.',
			'Reason: No longer needed'
		]);
	});

	test('no reason paragraph when action_log is null', () => {
		const [guest, host] = appointmentCancelledByHost(sampleInput);

		expect(guest.content.paragraphs).toEqual([]);
		expect(host.content.paragraphs).toEqual([
			'You cancelled the appointment for Jane Doe <jane@example.com>.'
		]);
	});
});
