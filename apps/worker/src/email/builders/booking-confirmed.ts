import {
	answerRows,
	attendeeLabel,
	deriveBrand,
	eventTypeName,
	whenForAttendee,
	whenForOrganizer
} from '../format.js';
import { requestIcs } from '../ics.js';
import { attendeeMessage, organizerMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingConfirmed(i: BookingEmailInput): (EmailMessage | null)[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const attendeeWhen = whenForAttendee(i);
	const organizerWhen = whenForOrganizer(i);

	const attendee: EmailContent = {
		brand,
		subject: `Confirmed: ${eventName} with ${brand.name}`,
		heading: 'Your booking is confirmed.',
		paragraphs: [],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: attendeeWhen },
			{ label: 'Where', value: a.location }
		],
		actions: [{ href: i.links.booked, label: 'View this booking', variant: 'primary' }],
		previewText: `See you on ${attendeeWhen}.`
	};
	const admin: EmailContent = {
		brand,
		subject: `New booking: ${eventName} with ${a.attendee_name}`,
		heading: 'New booking',
		paragraphs: [`${attendeeLabel(a)} just booked.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: organizerWhen },
			{ label: 'Where', value: a.location },
			...answerRows(a)
		],
		actions: [],
		previewText: `Scheduled for ${organizerWhen}.`
	};

	return [attendeeMessage(i, attendee, requestIcs(i, i.links.booked)), organizerMessage(i, admin)];
}
