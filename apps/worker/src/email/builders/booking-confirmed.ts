import {
	answerRows,
	attendeeLabel,
	deriveBrand,
	eventTypeName,
	whenForAttendee,
	whenForOrganizer
} from '../format.js';
import { requestIcs } from '../ics.js';
import { attendeeMessage, messages, organizerMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingConfirmed(i: BookingEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const attendeeWhen = whenForAttendee(i);
	const organizerWhen = whenForOrganizer(i);

	const attendee: EmailContent = {
		brand,
		subject: `Confirmed: ${eventName} with ${brand.name}`,
		heading: 'Your appointment is confirmed.',
		paragraphs: [],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: attendeeWhen },
			{ label: 'Where', value: a.location }
		],
		actions: [{ href: i.links.booked, label: 'View this appointment', variant: 'primary' }],
		previewText: `See you on ${attendeeWhen}.`
	};
	const admin: EmailContent = {
		brand,
		subject: `New appointment: ${eventName} with ${a.attendee_name}`,
		heading: 'New appointment',
		paragraphs: [`${attendeeLabel(a)} just scheduled an appointment.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: organizerWhen },
			{ label: 'Where', value: a.location },
			...answerRows(a)
		],
		actions: [],
		previewText: `Scheduled for ${organizerWhen}.`
	};

	return messages(
		attendeeMessage(i, attendee, requestIcs(i, i.links.booked)),
		organizerMessage(i, admin)
	);
}
