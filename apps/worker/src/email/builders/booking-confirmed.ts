import { deriveBrand, eventTypeName, fmtWhen } from '../format.js';
import { requestIcs } from '../ics.js';
import { attendeeMessage, organizerMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingConfirmed(i: BookingEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);

	const attendee: EmailContent = {
		brand,
		subject: `Confirmed: ${eventName} with ${brand.name}`,
		heading: 'Your booking is confirmed.',
		paragraphs: [],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: when },
			{ label: 'Where', value: a.location }
		],
		actions: [{ href: i.links.booked, label: 'View this booking', variant: 'primary' }],
		previewText: `See you on ${when}.`
	};
	const admin: EmailContent = {
		brand,
		subject: `New booking: ${eventName} with ${a.attendee_name}`,
		heading: 'New booking',
		paragraphs: [`${a.attendee_name} <${a.attendee_email}> just booked.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: when },
			{ label: 'Where', value: a.location },
			{ label: 'Notes', value: a.attendee_notes }
		],
		actions: [],
		previewText: `Scheduled for ${when}.`
	};

	return [attendeeMessage(i, attendee, requestIcs(i, i.links.booked)), organizerMessage(i, admin)];
}
