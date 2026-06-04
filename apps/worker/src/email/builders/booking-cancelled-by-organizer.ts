import { deriveBrand, eventTypeName, fmtWhen } from '../format.js';
import { cancelIcs } from '../ics.js';
import { attendeeEnvelope, organizerEnvelope, type Envelope } from '../recipients.js';
import { renderHtmlBody, renderTextBody } from '../render.js';
import type { BookingEmailInput } from '../types.js';

export async function bookingCancelledByOrganizer(i: BookingEmailInput): Promise<Envelope[]> {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg);
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);

	const attendee = { brand, eventName, when, userName: i.cfg.user.name };
	const admin = {
		brand,
		eventName,
		when,
		attendeeLine: `${a.attendee_name} <${a.attendee_email}>`
	};

	return [
		attendeeEnvelope(i, {
			subject: `Cancelled: ${eventName} with ${brand.name}`,
			html: await renderHtmlBody('booking-cancelled-by-organizer.attendee', attendee),
			text: await renderTextBody('booking-cancelled-by-organizer.attendee', attendee),
			ics: cancelIcs(i, i.links.booked)
		}),
		organizerEnvelope(i, {
			subject: `Cancelled: ${eventName} with ${a.attendee_name}`,
			html: await renderHtmlBody('booking-cancelled-by-organizer.admin', admin),
			text: await renderTextBody('booking-cancelled-by-organizer.admin', admin)
		})
	];
}
