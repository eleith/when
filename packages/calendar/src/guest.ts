import type { Appointment } from '@when/db';

export interface CalendarGuest {
	email: string;
	name: string;
}

export function attendeeGuest(
	appointment: Pick<Appointment, 'attendee_name' | 'attendee_email'>
): CalendarGuest | null {
	return appointment.attendee_email
		? { email: appointment.attendee_email, name: appointment.attendee_name }
		: null;
}
