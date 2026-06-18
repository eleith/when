import {
	answerRows,
	attendeeLabel,
	deriveBrand,
	eventTypeName,
	whenForAttendee,
	whenForOrganizer
} from '../format.js';
import { cancelIcs } from '../ics.js';
import { attendeeMessage, messages, organizerMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingCancelledByAttendee(i: BookingEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const attendeeWhen = whenForAttendee(i);
	const organizerWhen = whenForOrganizer(i);

	const attendee: EmailContent = {
		brand,
		subject: `Cancelled: ${eventName} with ${brand.name}`,
		heading: 'Your booking has been cancelled.',
		paragraphs: [],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: attendeeWhen }
		],
		actions: [],
		previewText: `Was scheduled for ${attendeeWhen}.`
	};
	const admin: EmailContent = {
		brand,
		subject: `Cancelled: ${eventName} with ${a.attendee_name}`,
		heading: 'Booking cancelled',
		paragraphs: [`${attendeeLabel(a)} cancelled this booking.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: organizerWhen },
			...answerRows(a)
		],
		actions: [],
		previewText: `Was scheduled for ${organizerWhen}.`
	};

	return messages(
		attendeeMessage(i, attendee, cancelIcs(i, i.links.booked)),
		organizerMessage(i, admin)
	);
}
