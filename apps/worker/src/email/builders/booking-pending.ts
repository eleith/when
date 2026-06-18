import {
	answerRows,
	attendeeLabel,
	deriveBrand,
	eventTypeName,
	whenForAttendee,
	whenForOrganizer
} from '../format.js';
import { attendeeMessage, messages, organizerMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingPending(i: BookingEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const attendeeWhen = whenForAttendee(i);
	const organizerWhen = whenForOrganizer(i);

	const attendee: EmailContent = {
		brand,
		subject: `Booking request received: ${eventName} with ${brand.name}`,
		heading: 'Your booking request was received.',
		paragraphs: [`${brand.name} will review your request and email you to confirm.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: attendeeWhen },
			{ label: 'Where', value: a.location }
		],
		actions: [{ href: i.links.booked, label: 'View this booking', variant: 'primary' }],
		previewText: `Requested for ${attendeeWhen}.`
	};
	const organizer: EmailContent = {
		brand,
		subject: `Booking request: ${eventName} from ${a.attendee_name}`,
		heading: 'New booking request',
		paragraphs: [`${attendeeLabel(a)} requested this booking.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: organizerWhen },
			{ label: 'Where', value: a.location },
			...answerRows(a)
		],
		actions: [{ href: i.links.manage, label: 'Review request', variant: 'primary' }],
		previewText: `Requested for ${organizerWhen}.`
	};

	return messages(attendeeMessage(i, attendee), organizerMessage(i, organizer));
}
