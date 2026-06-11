import type { EventType } from '@when/config';
import type { Appointment } from '@when/db';

// Kept identical to web's booking/links.ts (we duplicate rather than share a
// package, so mirror any edit there to here). The worker passes config.url.app
// as baseUrl since it has no request to derive an origin from.

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
