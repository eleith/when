import {
	answerRows,
	attendeeLabel,
	deriveBrand,
	eventTypeName,
	whenForAttendee,
	whenForOrganizer
} from '../format.js';
import { attendeeMessage, organizerMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingDeclined(i: BookingEmailInput): (EmailMessage | null)[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const attendeeWhen = whenForAttendee(i);
	const organizerWhen = whenForOrganizer(i);

	const attendee: EmailContent = {
		brand,
		subject: `Declined: ${eventName} with ${brand.name}`,
		heading: 'Your booking request was declined.',
		paragraphs: [],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: attendeeWhen }
		],
		actions: [],
		previewText: `Was requested for ${attendeeWhen}.`
	};
	const admin: EmailContent = {
		brand,
		subject: `Declined: ${eventName} from ${a.attendee_name}`,
		heading: 'Booking declined',
		paragraphs: [`You declined the request from ${attendeeLabel(a)}.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: organizerWhen },
			...answerRows(a)
		],
		actions: [],
		previewText: `Was requested for ${organizerWhen}.`
	};

	return [attendeeMessage(i, attendee), organizerMessage(i, admin)];
}
