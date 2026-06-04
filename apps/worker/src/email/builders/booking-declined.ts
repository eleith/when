import { deriveBrand, eventTypeName, fmtWhen } from '../format.js';
import { attendeeEnvelope, organizerEnvelope, type Envelope } from '../recipients.js';
import { renderHtmlBody, renderTextBody } from '../render.js';
import type { BookingEmailInput } from '../types.js';

// A declined request has no calendar event, so no ICS and no booking links.
export async function bookingDeclined(i: BookingEmailInput): Promise<Envelope[]> {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg);
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);

	const attendee = { brand, eventName, when };
	const admin = {
		brand,
		eventName,
		when,
		attendeeLine: `${a.attendee_name}'s <${a.attendee_email}>`
	};

	return [
		attendeeEnvelope(i, {
			subject: `Declined: ${eventName} with ${brand.name}`,
			html: await renderHtmlBody('booking-declined.attendee', attendee),
			text: await renderTextBody('booking-declined.attendee', attendee)
		}),
		organizerEnvelope(i, {
			subject: `Declined: ${eventName} from ${a.attendee_name}`,
			html: await renderHtmlBody('booking-declined.admin', admin),
			text: await renderTextBody('booking-declined.admin', admin)
		})
	];
}
