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

export function bookingRescheduledByOrganizer(i: BookingEmailInput): (EmailMessage | null)[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const attendeeWhen = whenForAttendee(i);
	const organizerWhen = whenForOrganizer(i);
	const attendeeRows = [
		{ label: 'What', value: eventName },
		{ label: 'When', value: attendeeWhen },
		{ label: 'Where', value: a.location }
	];
	const organizerRows = [
		{ label: 'What', value: eventName },
		{ label: 'When', value: organizerWhen },
		...answerRows(a)
	];

	if (a.status === 'pending') {
		const attendee: EmailContent = {
			brand,
			subject: `New time proposed: ${eventName} with ${brand.name}`,
			heading: `${brand.name} proposed a new time for your request.`,
			paragraphs: [`${brand.name} will confirm the new time and email you.`],
			rows: attendeeRows,
			actions: [{ href: i.links.booked, label: 'View this booking', variant: 'primary' }],
			previewText: `Requested for ${attendeeWhen}.`
		};
		const organizer: EmailContent = {
			brand,
			subject: `Rescheduled: ${eventName} with ${a.attendee_name}`,
			heading: 'Booking rescheduled',
			paragraphs: [`You moved the pending request for ${attendeeLabel(a)} to a new time.`],
			rows: organizerRows,
			actions: [],
			previewText: `Requested for ${organizerWhen}.`
		};
		return [attendeeMessage(i, attendee), organizerMessage(i, organizer)];
	}

	const attendee: EmailContent = {
		brand,
		subject: `Rescheduled: ${eventName} with ${brand.name}`,
		heading: `${brand.name} moved this booking to a new time.`,
		paragraphs: [],
		rows: attendeeRows,
		actions: [{ href: i.links.booked, label: 'View this booking', variant: 'primary' }],
		previewText: `Now scheduled for ${attendeeWhen}.`
	};
	const organizer: EmailContent = {
		brand,
		subject: `Rescheduled: ${eventName} with ${a.attendee_name}`,
		heading: 'Booking rescheduled',
		paragraphs: [`You rescheduled the booking for ${attendeeLabel(a)}.`],
		rows: organizerRows,
		actions: [],
		previewText: `Now scheduled for ${organizerWhen}.`
	};
	return [
		attendeeMessage(i, attendee, requestIcs(i, i.links.booked)),
		organizerMessage(i, organizer)
	];
}
