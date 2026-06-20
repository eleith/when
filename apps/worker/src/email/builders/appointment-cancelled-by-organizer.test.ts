import { describe, expect, test } from 'vitest';
import { appointmentCancelledByOrganizer } from './appointment-cancelled-by-organizer.js';
import { sampleAppointment, sampleInput } from '../__fixtures__/appointment.js';

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

	test('includes cancel reason in both messages when present', () => {
		const input = {
			...sampleInput,
			appointment: {
				...sampleAppointment,
				action_log: JSON.stringify([
					{
						action: 'cancel',
						actor: 'organizer',
						at: '2026-01-01T12:00:00Z',
						payload: { note: 'No longer needed' }
					}
				])
			}
		};
		const [attendee, organizer] = appointmentCancelledByOrganizer(input);

		expect(attendee.content.paragraphs).toEqual(['Reason: No longer needed']);
		expect(organizer.content.paragraphs).toEqual([
			'You cancelled the appointment for Jane Doe <jane@example.com>.',
			'Reason: No longer needed'
		]);
	});

	test('no reason paragraph when action_log is null', () => {
		const [attendee, organizer] = appointmentCancelledByOrganizer(sampleInput);

		expect(attendee.content.paragraphs).toEqual([]);
		expect(organizer.content.paragraphs).toEqual([
			'You cancelled the appointment for Jane Doe <jane@example.com>.'
		]);
	});
});
