import type { EventType } from '@when/config';
import type { Appointment } from '../db';

export interface BookingLinks {
	/** Booking landing page. */
	booked: string;
	/** Landing page with the cancel dialog open. */
	cancel: string;
	/** Reschedule flow for this booking (falls back to the landing page if the event type is gone). */
	reschedule: string;
	/** Sign-in deep link back to the booking (organizer review). */
	manage: string;
}

export interface BookingLinksInput {
	/** Request origin, e.g. `https://when.example.com`. */
	baseUrl: string;
	appointment: Pick<Appointment, 'id' | 'cancel_token'>;
	eventType?: Pick<EventType, 'slug'>;
}

/** All action URLs for a booking, derived from its id + cancel token + the event type slug. */
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
