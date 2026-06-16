import { deriveBrand, eventTypeName, whenForAttendee, whenForOrganizer } from '../format.js';
import { requestIcs } from '../ics.js';
import { attendeeMessage, organizerMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingRescheduledByOrganizer(i: BookingEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const attendeeWhen = whenForAttendee(i);
	const organizerWhen = whenForOrganizer(i);
	// Moving a not-yet-accepted request leaves it pending; an accepted booking stays confirmed.
	const pending = a.status === 'pending';

	const attendee: EmailContent = {
		brand,
		subject: pending
			? `New time proposed: ${eventName} with ${brand.name}`
			: `Rescheduled: ${eventName} with ${brand.name}`,
		heading: pending
			? `${brand.name} proposed a new time for your request.`
			: `${brand.name} moved this booking to a new time.`,
		paragraphs: pending ? [`${brand.name} will confirm the new time and email you.`] : [],
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
		subject: `Rescheduled: ${eventName} with ${a.attendee_name}`,
		heading: 'Booking rescheduled',
		paragraphs: [
			pending
				? `You moved the pending request for ${a.attendee_name} <${a.attendee_email}> to a new time.`
				: `You rescheduled the booking for ${a.attendee_name} <${a.attendee_email}>.`
		],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: organizerWhen }
		],
		actions: [],
		previewText: pending ? `Requested for ${organizerWhen}.` : `Now scheduled for ${organizerWhen}.`
	};

	// A pending move isn't booked at the new time yet, so it carries no calendar invite.
	const attendeeIcs = pending ? undefined : requestIcs(i, i.links.booked);
	return [attendeeMessage(i, attendee, attendeeIcs), organizerMessage(i, admin)];
}
