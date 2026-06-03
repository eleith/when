import { deriveBrand, eventTypeName, fmtWhen } from '../format.js';
import { requestIcs } from '../ics.js';
import { attendeeEnvelope, organizerEnvelope, type Envelope } from '../recipients.js';
import { renderHtmlBody, renderTextBody } from '../render.js';
import type { BookingEmailInput } from '../types.js';

export async function bookingConfirmed(i: BookingEmailInput): Promise<Envelope[]> {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg);
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);
	const links = i.links;

	// One data shape per envelope, fed to both the html and text templates.
	const attendee = { brand, eventName, when, location: a.location, links };
	const admin = {
		brand,
		eventName,
		when,
		location: a.location,
		notes: a.attendee_notes,
		attendeeLine: `${a.attendee_name} <${a.attendee_email}>`
	};

	return [
		attendeeEnvelope(i, {
			subject: `Confirmed: ${eventName} with ${brand.name}`,
			html: await renderHtmlBody('booking-confirmed.attendee', attendee),
			text: await renderTextBody('booking-confirmed.attendee', attendee),
			ics: requestIcs(i, links.booked)
		}),
		organizerEnvelope(i, {
			subject: `New booking: ${eventName} with ${a.attendee_name}`,
			html: await renderHtmlBody('booking-confirmed.admin', admin),
			text: await renderTextBody('booking-confirmed.admin', admin)
		})
	];
}
