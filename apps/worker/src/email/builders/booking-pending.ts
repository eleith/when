import { deriveBrand, eventTypeName, fmtWhen } from '../format.js';
import { attendeeMessage, organizerMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingPending(i: BookingEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);

	const attendee: EmailContent = {
		brand,
		subject: `Booking request received: ${eventName} with ${brand.name}`,
		heading: 'Your booking request was received.',
		paragraphs: [`${brand.name} will review your request and email you to confirm.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: when },
			{ label: 'Where', value: a.location }
		],
		actions: [{ href: i.links.booked, label: 'View this booking', variant: 'primary' }],
		previewText: `Requested for ${when}.`
	};
	const organizer: EmailContent = {
		brand,
		subject: `Booking request: ${eventName} from ${a.attendee_name}`,
		heading: 'New booking request',
		paragraphs: [`${a.attendee_name} <${a.attendee_email}> requested this booking.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: when },
			{ label: 'Where', value: a.location }
		],
		actions: [{ href: i.links.manage, label: 'Review request', variant: 'primary' }],
		previewText: `Requested for ${when}.`
	};

	return [attendeeMessage(i, attendee), organizerMessage(i, organizer)];
}
