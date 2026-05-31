import Attendee from './booking-cancelled-by-attendee.attendee.svelte';
import Admin from './booking-cancelled-by-attendee.admin.svelte';
import { bookingLinks } from '$lib/server/booking/links';
import { deriveBrand, eventTypeName, fmtWhen } from '$lib/server/email/format';
import { cancelIcs } from '$lib/server/email/ics';
import { attendeeEnvelope, organizerEnvelope } from '$lib/server/email/recipients';
import { renderEmail } from '$lib/server/email/render';
import type { Envelope } from '$lib/server/email/send';
import { lines } from '$lib/server/email/text';
import type { BookingEmailInput } from '$lib/server/email/types';

export function bookingCancelledByAttendee(i: BookingEmailInput): Envelope[] {
	const a = i.appointment;
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);
	const brand = deriveBrand(i.cfg);
	const links = bookingLinks({ baseUrl: i.baseUrl, appointment: a, eventType: i.eventType });

	return [
		attendeeEnvelope(i, {
			subject: `Cancelled: ${eventName} with ${i.cfg.user.name}`,
			html: renderEmail(Attendee, {
				orgName: brand.name,
				primaryColor: brand.primaryColor,
				eventName,
				when
			}),
			text: lines(
				'Your booking has been cancelled.',
				'',
				`What: ${eventName}`,
				`When: ${when}`
			),
			ics: cancelIcs(i, links.booked)
		}),
		organizerEnvelope(i, {
			subject: `Cancelled: ${eventName} with ${a.attendee_name}`,
			html: renderEmail(Admin, {
				orgName: brand.name,
				primaryColor: brand.primaryColor,
				eventName,
				attendeeLine: `${a.attendee_name} <${a.attendee_email}>`,
				when
			}),
			text: lines(
				`${a.attendee_name} <${a.attendee_email}> cancelled ${eventName}.`,
				'',
				`When: ${when}`
			)
		})
	];
}
