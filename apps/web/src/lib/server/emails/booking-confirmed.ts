import Attendee from './booking-confirmed.attendee.svelte';
import Admin from './booking-confirmed.admin.svelte';
import { bookingLinks } from '$lib/server/booking/links';
import { deriveBrand, eventTypeName, fmtWhen } from '$lib/server/email/format';
import { requestIcs } from '$lib/server/email/ics';
import { attendeeEnvelope, organizerEnvelope } from '$lib/server/email/recipients';
import { renderEmail } from '$lib/server/email/render';
import type { Envelope } from '$lib/server/email/send';
import { lines } from '$lib/server/email/text';
import type { BookingEmailInput } from '$lib/server/email/types';

export function bookingConfirmed(i: BookingEmailInput): Envelope[] {
	const a = i.appointment;
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);
	const brand = deriveBrand(i.cfg);
	const links = bookingLinks({ baseUrl: i.baseUrl, appointment: a, eventType: i.eventType });

	return [
		attendeeEnvelope(i, {
			subject: `Confirmed: ${eventName} with ${i.cfg.user.name}`,
			html: renderEmail(Attendee, {
				orgName: brand.name,
				primaryColor: brand.primaryColor,
				eventName,
				when,
				location: a.location,
				links
			}),
			text: lines(
				'Your booking is confirmed.',
				'',
				`What: ${eventName}`,
				`When: ${when}`,
				a.location ? `Where: ${a.location}` : null,
				'',
				`Reschedule: ${links.reschedule}`,
				`Cancel: ${links.cancel}`
			),
			ics: requestIcs(i, links.booked)
		}),
		organizerEnvelope(i, {
			subject: `New booking: ${eventName} with ${a.attendee_name}`,
			html: renderEmail(Admin, {
				orgName: brand.name,
				primaryColor: brand.primaryColor,
				eventName,
				attendeeLine: `${a.attendee_name} <${a.attendee_email}>`,
				when,
				location: a.location,
				notes: a.attendee_notes
			}),
			text: lines(
				`${a.attendee_name} <${a.attendee_email}> just booked ${eventName}.`,
				'',
				`When: ${when}`,
				a.location ? `Where: ${a.location}` : null,
				a.attendee_notes ? `\nNotes: ${a.attendee_notes}` : null
			)
		})
	];
}
