import { deriveBrand, eventTypeName, fmtWhen } from '../format.js';
import { organizerEnvelope, type Envelope } from '../recipients.js';
import { renderHtmlBody, renderTextBody } from '../render.js';
import type { BookingEmailInput } from '../types.js';

export async function bookingPendingToOrganizer(i: BookingEmailInput): Promise<Envelope[]> {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg);
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);
	const duration = i.eventType ? `${i.eventType.duration} min` : null;

	const data = {
		brand,
		eventName,
		attendeeLine: `${a.attendee_name} <${a.attendee_email}>`,
		when,
		duration,
		location: a.location,
		manageUrl: i.links.manage
	};

	return [
		organizerEnvelope(i, {
			subject: `Booking request: ${eventName} from ${a.attendee_name}`,
			html: await renderHtmlBody('booking-pending-to-organizer', data),
			text: await renderTextBody('booking-pending-to-organizer', data)
		})
	];
}
