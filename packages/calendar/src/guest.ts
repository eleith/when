import type { Appointment } from '@when/db';

export interface CalendarGuest {
	email: string;
	name: string;
}

export function guestContact(
	appointment: Pick<Appointment, 'guest_name' | 'guest_email'>
): CalendarGuest | null {
	return appointment.guest_email
		? { email: appointment.guest_email, name: appointment.guest_name }
		: null;
}
