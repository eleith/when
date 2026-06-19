import type { Appointment } from '@when/db';

// Builds web's appointment action URLs. The worker has no incoming request to derive
// an origin from, so it passes config.url.app as the base URL.

export interface AppointmentLinks {
	booked: string;
	reschedule: string;
	manage: string;
}

export interface AppointmentLinksInput {
	baseUrl: string;
	appointment: Pick<Appointment, 'id' | 'cancel_token'>;
}

export function appointmentLinks({
	baseUrl,
	appointment
}: AppointmentLinksInput): AppointmentLinks {
	const token = encodeURIComponent(appointment.cancel_token);
	const booked = `${baseUrl}/appointment/${appointment.id}?token=${token}`;
	return {
		booked,
		reschedule: `${baseUrl}/appointment/${appointment.id}/reschedule?token=${token}`,
		manage: `${baseUrl}/signin?callbackUrl=${encodeURIComponent(`/appointment/${appointment.id}`)}`
	};
}
