import Body from './booking-pending-to-attendee.svelte';
import { bookingLinks } from '$lib/server/booking/links';
import { deriveBrand, eventTypeName, fmtWhen } from '$lib/server/email/format';
import { attendeeEnvelope } from '$lib/server/email/recipients';
import { renderEmail } from '$lib/server/email/render';
import type { Envelope } from '$lib/server/email/send';
import { lines } from '$lib/server/email/text';
import type { BookingEmailInput } from '$lib/server/email/types';

export function bookingPendingToAttendee(i: BookingEmailInput): Envelope[] {
	const a = i.appointment;
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);
	const brand = deriveBrand(i.cfg);
	const links = bookingLinks({ baseUrl: i.baseUrl, appointment: a, eventType: i.eventType });

	return [
		attendeeEnvelope(i, {
			subject: `Booking request received: ${eventName} with ${i.cfg.user.name}`,
			html: renderEmail(Body, {
				orgName: brand.name,
				primaryColor: brand.primaryColor,
				eventName,
				attendeeEmail: a.attendee_email,
				when,
				location: a.location,
				links
			}),
			text: lines(
				`Thanks — we got your request to book ${eventName}.`,
				'',
				`${i.cfg.user.name} will review and confirm. You'll get a follow-up email at ${a.attendee_email} with the outcome.`,
				'',
				`When: ${when}`,
				a.location ? `Where: ${a.location}` : null,
				'',
				'Need to change something before then?',
				`Reschedule: ${links.reschedule}`,
				`Cancel: ${links.cancel}`
			)
		})
	];
}
