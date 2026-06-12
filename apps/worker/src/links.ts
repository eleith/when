import type { EventType } from '@when/config';
import type { Appointment } from '@when/db';

// Builds web's booking action URLs. The worker has no incoming request to derive
// an origin from, so it passes config.url.app as the base URL.

export interface BookingLinks {
	booked: string;
	cancel: string;
	reschedule: string;
	manage: string;
}

export interface BookingLinksInput {
	baseUrl: string;
	appointment: Pick<Appointment, 'id' | 'cancel_token'>;
	eventType?: Pick<EventType, 'slug'>;
}

export function bookingLinks({ baseUrl, appointment, eventType }: BookingLinksInput): BookingLinks {
	const token = encodeURIComponent(appointment.cancel_token);
	const booked = `${baseUrl}/booked/${appointment.id}?token=${token}`;
	return {
		booked,
		cancel: `${booked}&cancel=1`,
		reschedule: eventType
			? `${baseUrl}/schedule/${eventType.slug}?reschedule=${appointment.id}&token=${token}`
			: booked,
		manage: `${baseUrl}/signin?callbackUrl=${encodeURIComponent(`/booked/${appointment.id}`)}`
	};
}
