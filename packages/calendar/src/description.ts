import { parseGuestAnswers } from '@when/config';
import type { Appointment } from '@when/db';

type DescribableAppointment = Pick<
	Appointment,
	'guest_name' | 'guest_email' | 'guest_answers' | 'note'
>;

export function describeAppointment(
	appointment: DescribableAppointment,
	cancelUrl: string
): string {
	const lines = [`Name: ${appointment.guest_name}`];
	if (appointment.guest_email) lines.push(`Email: ${appointment.guest_email}`);
	for (const answer of parseGuestAnswers(appointment.guest_answers)) {
		if (answer.value) lines.push(`${answer.label}: ${answer.value}`);
	}
	if (appointment.note) lines.push(`Note: ${appointment.note}`);
	return `${lines.join('\n')}\n\nReschedule or cancel: ${cancelUrl}`;
}
