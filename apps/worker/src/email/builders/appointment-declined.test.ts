import { describe, expect, test } from 'vitest';
import { appointmentDeclined } from './appointment-declined.js';
import { sampleInput } from '../__fixtures__/appointment.js';

describe('appointmentDeclined', () => {
	test('guest + host messages, no ics', () => {
		const [guest, host] = appointmentDeclined(sampleInput);

		expect(guest.to).toBe('jane@example.com');
		expect(guest.content.subject).toBe('Declined: 30-min with Acme Scheduling');
		expect(guest.content.heading).toBe('Your appointment request was declined.');
		expect(guest.ics).toBeUndefined();

		expect(host.content.subject).toBe('Declined: 30-min from Jane Doe');
		expect(host.content.paragraphs).toContain(
			'You declined the request from Jane Doe <jane@example.com>.'
		);
		expect(host.ics).toBeUndefined();
	});
});
