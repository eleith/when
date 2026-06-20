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

export function appointmentRescheduledByAttendee(i: AppointmentEmailInput): EmailMessage[] {
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
			subject: `Reschedule requested: ${eventName} with ${brand.name}`,
			heading: 'Your reschedule request was received.',
			paragraphs: [
				`${brand.name} will review the new time and email you to confirm.`,
				...(i.rescheduleReason ? [`Reason for rescheduling: ${i.rescheduleReason}`] : [])
			],
			rows: attendeeRows,
			actions: [{ href: i.links.booked, label: 'View this appointment', variant: 'primary' }],
			previewText: `Requested for ${attendeeWhen}.`
		};
		const organizer: EmailContent = {
			brand,
			subject: `Reschedule request: ${eventName} from ${a.attendee_name}`,
			heading: 'Reschedule request',
			paragraphs: [
				`${attendeeLabel(a)} asked to move this appointment to a new time.`,
				...(i.rescheduleReason ? [`Reason for rescheduling: ${i.rescheduleReason}`] : [])
			],
			rows: organizerRows,
			actions: [{ href: i.links.manage, label: 'Review request', variant: 'primary' }],
			previewText: `Requested for ${organizerWhen}.`
		};
		return messages(attendeeMessage(i, attendee), organizerMessage(i, organizer));
	}

	const attendee: EmailContent = {
		brand,
		subject: `Rescheduled: ${eventName} with ${brand.name}`,
		heading: 'Your appointment moved to a new time.',
		paragraphs: i.rescheduleReason ? [`Reason for rescheduling: ${i.rescheduleReason}`] : [],
		rows: attendeeRows,
		actions: [{ href: i.links.booked, label: 'View this appointment', variant: 'primary' }],
		previewText: `Now scheduled for ${attendeeWhen}.`
	};
	const organizer: EmailContent = {
		brand,
		subject: `Rescheduled: ${eventName} with ${a.attendee_name}`,
		heading: 'Appointment rescheduled',
		paragraphs: [
			`${attendeeLabel(a)} rescheduled this appointment.`,
			...(i.rescheduleReason ? [`Reason for rescheduling: ${i.rescheduleReason}`] : [])
		],
		rows: organizerRows,
		actions: [],
		previewText: `Now scheduled for ${organizerWhen}.`
	};
	return messages(
		attendeeMessage(i, attendee, requestIcs(i, i.links.booked)),
		organizerMessage(i, organizer)
	);
}
