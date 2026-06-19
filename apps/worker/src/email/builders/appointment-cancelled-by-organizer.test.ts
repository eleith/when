import { describe, expect, test } from 'vitest';
import { appointmentCancelledByOrganizer } from './appointment-cancelled-by-organizer.js';
import { sampleInput } from '../__fixtures__/appointment.js';

describe('appointmentCancelledByOrganizer', () => {
	test('attendee (named by organizer, CANCEL ics) + organizer messages', () => {
		const [attendee, organizer] = appointmentCancelledByOrganizer(sampleInput);

		expect(attendee.to).toBe('jane@example.com');
		expect(attendee.content.subject).toBe('Cancelled: 30-min with Acme Scheduling');
		expect(attendee.content.heading).toBe('Acme Scheduling cancelled this appointment.');
		expect(attendee.ics?.content).toContain('METHOD:CANCEL');

		expect(organizer.content.subject).toBe('Cancelled: 30-min with Jane Doe');
		expect(organizer.content.paragraphs).toContain(
			'You cancelled the appointment for Jane Doe <jane@example.com>.'
		);
		expect(organizer.ics).toBeUndefined();
	});
});
