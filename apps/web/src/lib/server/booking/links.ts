import type { EventType } from '@when/config';
import type { Appointment } from '@when/db';
import type { BookingLinks } from '@when/jobs';

// The shape is the producer↔worker contract (it travels in the job payload), so
// it lives in @when/jobs; web owns the function that builds it. Re-export so
// existing web imports of BookingLinks keep working.
export type { BookingLinks };

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
