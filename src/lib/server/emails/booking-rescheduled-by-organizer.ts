import Attendee from './booking-rescheduled-by-organizer.attendee.svelte';
import Admin from './booking-rescheduled-by-organizer.admin.svelte';
import { bookingLinks } from '$lib/server/booking/links';
import { deriveBrand, eventTypeName, fmtWhen } from '$lib/server/email/format';
import { requestIcs } from '$lib/server/email/ics';
import { attendeeEnvelope, organizerEnvelope } from '$lib/server/email/recipients';
import { renderEmail } from '$lib/server/email/render';
import type { Envelope } from '$lib/server/email/send';
import { lines } from '$lib/server/email/text';
import type { BookingEmailInput } from '$lib/server/email/types';

export function bookingRescheduledByOrganizer(i: BookingEmailInput): Envelope[] {
	const a = i.appointment;
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);
	const brand = deriveBrand(i.cfg);
	const links = bookingLinks({ baseUrl: i.baseUrl, appointment: a, eventType: i.eventType });

	return [
		attendeeEnvelope(i, {
			subject: `Rescheduled: ${eventName} with ${i.cfg.user.name}`,
			html: renderEmail(Attendee, {
				orgName: brand.name,
				primaryColor: brand.primaryColor,
				eventName,
				when,
				location: a.location,
				links,
				userName: i.cfg.user.name
			}),
			text: lines(
				`${i.cfg.user.name} moved this booking to a new time.`,
				'',
				`What: ${eventName}`,
				`When: ${a.start_time}`,
				a.location ? `Where: ${a.location}` : null,
				'',
				`Reschedule: ${links.reschedule}`,
				`Cancel: ${links.cancel}`
			),
			ics: requestIcs(i, links.booked)
		}),
		organizerEnvelope(i, {
			subject: `Rescheduled: ${eventName} with ${a.attendee_name}`,
			html: renderEmail(Admin, {
				orgName: brand.name,
				primaryColor: brand.primaryColor,
				eventName,
				attendeeLine: `${a.attendee_name} <${a.attendee_email}>`,
				when
			}),
			text: lines(
				`You rescheduled ${a.attendee_name} <${a.attendee_email}> booking for ${eventName}.`,
				'',
				`When: ${a.start_time}`
			)
		})
	];
}
