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
	const attendeeRows = [
		{ label: 'What', value: eventName },
		{ label: 'When', value: attendeeWhen },
		{ label: 'Where', value: a.location }
	];
	const organizerRows = [
		{ label: 'What', value: eventName },
		{ label: 'When', value: organizerWhen }
	];

	// A move on a requires-confirmation event lands pending: the organizer must re-approve, and
	// nothing is booked at the new time yet (no calendar invite).
	if (a.status === 'pending') {
		const attendee: EmailContent = {
			brand,
			subject: `Reschedule requested: ${eventName} with ${brand.name}`,
			heading: 'Your reschedule request was received.',
			paragraphs: [`${brand.name} will review the new time and email you to confirm.`],
			rows: attendeeRows,
			actions: [{ href: i.links.booked, label: 'View this booking', variant: 'primary' }],
			previewText: `Requested for ${attendeeWhen}.`
		};
		const organizer: EmailContent = {
			brand,
			subject: `Reschedule request: ${eventName} from ${a.attendee_name}`,
			heading: 'Reschedule request',
			paragraphs: [
				`${a.attendee_name} <${a.attendee_email}> asked to move this booking to a new time.`
			],
			rows: organizerRows,
			actions: [{ href: i.links.manage, label: 'Review request', variant: 'primary' }],
			previewText: `Requested for ${organizerWhen}.`
		};
		return [attendeeMessage(i, attendee), organizerMessage(i, organizer)];
	}

	const attendee: EmailContent = {
		brand,
		subject: `Rescheduled: ${eventName} with ${brand.name}`,
		heading: 'Your booking moved to a new time.',
		paragraphs: [],
		rows: attendeeRows,
		actions: [{ href: i.links.booked, label: 'View this booking', variant: 'primary' }],
		previewText: `Now scheduled for ${attendeeWhen}.`
	};
	const organizer: EmailContent = {
		brand,
		subject: `Rescheduled: ${eventName} with ${a.attendee_name}`,
		heading: 'Booking rescheduled',
		paragraphs: [`${a.attendee_name} <${a.attendee_email}> rescheduled this booking.`],
		rows: organizerRows,
		actions: [],
		previewText: `Now scheduled for ${organizerWhen}.`
	};
	return [
		attendeeMessage(i, attendee, requestIcs(i, i.links.booked)),
		organizerMessage(i, organizer)
	];
}
