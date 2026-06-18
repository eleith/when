import { parseAttendeeAnswers } from '@when/config';
import type { Appointment } from '@when/db';

type DescribableAppointment = Pick<
	Appointment,
	'attendee_name' | 'attendee_email' | 'attendee_answers'
>;

export function describeAppointment(
	appointment: DescribableAppointment,
	cancelUrl: string
): string {
	const lines = [`Name: ${appointment.attendee_name}`];
	if (appointment.attendee_email) lines.push(`Email: ${appointment.attendee_email}`);
	for (const answer of parseAttendeeAnswers(appointment.attendee_answers)) {
		if (answer.value) lines.push(`${answer.label}: ${answer.value}`);
	}
	return `${lines.join('\n')}\n\nReschedule or cancel: ${cancelUrl}`;
}
