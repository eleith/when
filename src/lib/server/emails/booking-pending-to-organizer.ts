import Body from './booking-pending-to-organizer.svelte';
import { bookingLinks } from '$lib/server/booking/links';
import { deriveBrand, eventTypeName, fmtWhen } from '$lib/server/email/format';
import { organizerEnvelope } from '$lib/server/email/recipients';
import { renderEmail } from '$lib/server/email/render';
import type { Envelope } from '$lib/server/email/send';
import { lines } from '$lib/server/email/text';
import type { BookingEmailInput } from '$lib/server/email/types';

export function bookingPendingToOrganizer(i: BookingEmailInput): Envelope[] {
	const a = i.appointment;
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);
	const duration = i.eventType ? `${i.eventType.duration} min` : null;
	const brand = deriveBrand(i.cfg);
	const manageUrl = bookingLinks({
		baseUrl: i.baseUrl,
		appointment: a,
		eventType: i.eventType
	}).manage;

	return [
		organizerEnvelope(i, {
			subject: `Booking request: ${eventName} from ${a.attendee_name}`,
			html: renderEmail(Body, {
				orgName: brand.name,
				primaryColor: brand.primaryColor,
				eventName,
				attendeeLine: `${a.attendee_name} <${a.attendee_email}>`,
				when,
				duration,
				location: a.location,
				manageUrl
			}),
			text: lines(
				`${a.attendee_name} <${a.attendee_email}> has requested to book ${eventName}.`,
				'',
				`When: ${a.start_time}`,
				duration ? `Duration: ${duration}` : null,
				a.location ? `Where: ${a.location}` : null,
				'',
				`Review request: ${manageUrl}`
			)
		})
	];
}
