import { describe, expect, test } from 'vitest';
import { appointmentCancelledByAttendee } from './appointment-cancelled-by-attendee.js';
import { sampleAppointment, sampleInput } from '../__fixtures__/appointment.js';

describe('appointmentCancelledByAttendee', () => {
	test('attendee (CANCEL ics) + organizer messages', () => {
		const [attendee, organizer] = appointmentCancelledByAttendee(sampleInput);

		expect(attendee.to).toBe('jane@example.com');
		expect(attendee.content.subject).toBe('Cancelled: 30-min with Acme Scheduling');
		expect(attendee.content.heading).toBe('Your appointment has been cancelled.');
		expect(attendee.content.rows).toEqual([
			{ label: 'What', value: '30-min' },
			{ label: 'When', value: expect.any(String) }
		]);
		expect(attendee.ics?.content).toContain('METHOD:CANCEL');

		expect(organizer.to).toBe('owner@acme.test');
		expect(organizer.content.subject).toBe('Cancelled: 30-min with Jane Doe');
		expect(organizer.content.paragraphs).toContain(
			'Jane Doe <jane@example.com> cancelled this appointment.'
		);
		expect(organizer.ics).toBeUndefined();
	});

	test('includes cancel reason in both messages when present', () => {
		const input = {
			...sampleInput,
			appointment: { ...sampleAppointment, cancel_reason: 'Double booked' }
		};
		const [attendee, organizer] = appointmentCancelledByAttendee(input);

		expect(attendee.content.paragraphs).toEqual(['Reason: Double booked']);
		expect(organizer.content.paragraphs).toEqual([
			'Jane Doe <jane@example.com> cancelled this appointment.',
			'Reason: Double booked'
		]);
	});

	test('no reason paragraph when cancel_reason is null', () => {
		const [attendee, organizer] = appointmentCancelledByAttendee(sampleInput);

		expect(attendee.content.paragraphs).toEqual([]);
		expect(organizer.content.paragraphs).toEqual([
			'Jane Doe <jane@example.com> cancelled this appointment.'
		]);
	});
});
