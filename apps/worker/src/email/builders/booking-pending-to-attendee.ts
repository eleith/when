import { deriveBrand, eventTypeName, fmtWhen } from '../format.js';
import { attendeeEnvelope, type Envelope } from '../recipients.js';
import { renderHtmlBody, renderTextBody } from '../render.js';
import type { BookingEmailInput } from '../types.js';

export async function bookingPendingToAttendee(i: BookingEmailInput): Promise<Envelope[]> {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg);
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);

	const data = {
		brand,
		eventName,
		attendeeEmail: a.attendee_email,
		when,
		location: a.location,
		links: i.links
	};

	return [
		attendeeEnvelope(i, {
			subject: `Booking request received: ${eventName} with ${brand.name}`,
			html: await renderHtmlBody('booking-pending-to-attendee', data),
			text: await renderTextBody('booking-pending-to-attendee', data)
		})
	];
}
