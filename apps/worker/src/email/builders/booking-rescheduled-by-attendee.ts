import { deriveBrand, eventTypeName, whenForAttendee, whenForOrganizer } from '../format.js';
import { requestIcs } from '../ics.js';
import { attendeeMessage, organizerMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingRescheduledByAttendee(i: BookingEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const attendeeWhen = whenForAttendee(i);
	const organizerWhen = whenForOrganizer(i);
	// A move on a requires-confirmation event lands pending: the organizer must re-approve.
	const pending = a.status === 'pending';

	const attendee: EmailContent = {
		brand,
		subject: pending
			? `Reschedule requested: ${eventName} with ${brand.name}`
			: `Rescheduled: ${eventName} with ${brand.name}`,
		heading: pending
			? 'Your reschedule request was received.'
			: 'Your booking moved to a new time.',
		paragraphs: pending ? [`${brand.name} will review the new time and email you to confirm.`] : [],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: attendeeWhen },
			{ label: 'Where', value: a.location }
		],
		actions: [{ href: i.links.booked, label: 'View this booking', variant: 'primary' }],
		previewText: pending ? `Requested for ${attendeeWhen}.` : `Now scheduled for ${attendeeWhen}.`
	};
	const admin: EmailContent = {
		brand,
		subject: pending
			? `Reschedule request: ${eventName} from ${a.attendee_name}`
			: `Rescheduled: ${eventName} with ${a.attendee_name}`,
		heading: pending ? 'Reschedule request' : 'Booking rescheduled',
		paragraphs: [
			pending
				? `${a.attendee_name} <${a.attendee_email}> asked to move this booking to a new time.`
				: `${a.attendee_name} <${a.attendee_email}> rescheduled this booking.`
		],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: organizerWhen }
		],
		actions: pending ? [{ href: i.links.manage, label: 'Review request', variant: 'primary' }] : [],
		previewText: pending ? `Requested for ${organizerWhen}.` : `Now scheduled for ${organizerWhen}.`
	};

	// A pending move isn't booked at the new time yet, so it carries no calendar invite.
	const attendeeIcs = pending ? undefined : requestIcs(i, i.links.booked);
	return [attendeeMessage(i, attendee, attendeeIcs), organizerMessage(i, admin)];
}
