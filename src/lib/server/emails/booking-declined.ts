import Attendee from './booking-declined.attendee.svelte';
import Admin from './booking-declined.admin.svelte';
import { deriveBrand, eventTypeName, fmtWhen } from '$lib/server/email/format';
import { attendeeEnvelope, organizerEnvelope } from '$lib/server/email/recipients';
import { renderEmail } from '$lib/server/email/render';
import type { Envelope } from '$lib/server/email/send';
import { lines } from '$lib/server/email/text';
import type { BookingEmailInput } from '$lib/server/email/types';

// No links → no baseUrl needed.
export function bookingDeclined(i: Omit<BookingEmailInput, 'baseUrl'>): Envelope[] {
	const a = i.appointment;
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);
	const brand = deriveBrand(i.cfg);

	return [
		attendeeEnvelope(i, {
			subject: `Declined: ${eventName} with ${i.cfg.user.name}`,
			html: renderEmail(Attendee, {
				orgName: brand.name,
				primaryColor: brand.primaryColor,
				eventName,
				when
			}),
			text: lines(
				'Your booking request was declined.',
				'',
				`What: ${eventName}`,
				`When: ${a.start_time}`
			)
		}),
		organizerEnvelope(i, {
			subject: `Declined: ${eventName} from ${a.attendee_name}`,
			html: renderEmail(Admin, {
				orgName: brand.name,
				primaryColor: brand.primaryColor,
				eventName,
				attendeeLine: `${a.attendee_name}'s <${a.attendee_email}>`,
				when
			}),
			text: lines(
				`You declined ${a.attendee_name}'s <${a.attendee_email}> request for ${eventName}.`,
				'',
				`When: ${a.start_time}`
			)
		})
	];
}
