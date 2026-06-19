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
import type { AppointmentEmailInput } from '../types.js';

export function appointmentRescheduledByOrganizer(i: AppointmentEmailInput): EmailMessage[] {
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
			actions: [{ href: i.links.booked, label: 'View this appointment', variant: 'primary' }],
			previewText: `Requested for ${attendeeWhen}.`
		};
		const organizer: EmailContent = {
			brand,
			subject: `Rescheduled: ${eventName} with ${a.attendee_name}`,
			heading: 'Appointment rescheduled',
			paragraphs: [`You moved the pending request for ${attendeeLabel(a)} to a new time.`],
			rows: organizerRows,
			actions: [],
			previewText: `Requested for ${organizerWhen}.`
		};
		return messages(attendeeMessage(i, attendee), organizerMessage(i, organizer));
	}

	const attendee: EmailContent = {
		brand,
		subject: `Rescheduled: ${eventName} with ${brand.name}`,
		heading: `${brand.name} moved this appointment to a new time.`,
		paragraphs: [],
		rows: attendeeRows,
		actions: [{ href: i.links.booked, label: 'View this appointment', variant: 'primary' }],
		previewText: `Now scheduled for ${attendeeWhen}.`
	};
	const organizer: EmailContent = {
		brand,
		subject: `Rescheduled: ${eventName} with ${a.attendee_name}`,
		heading: 'Appointment rescheduled',
		paragraphs: [`You rescheduled the appointment for ${attendeeLabel(a)}.`],
		rows: organizerRows,
		actions: [],
		previewText: `Now scheduled for ${organizerWhen}.`
	};
	return messages(
		attendeeMessage(i, attendee, requestIcs(i, i.links.booked)),
		organizerMessage(i, organizer)
	);
}
