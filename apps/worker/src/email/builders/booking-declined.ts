import { deriveBrand, eventTypeName, fmtWhen } from '../format.js';
import { attendeeMessage, organizerMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingDeclined(i: BookingEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);

	const attendee: EmailContent = {
		brand,
		subject: `Declined: ${eventName} with ${brand.name}`,
		heading: 'Your booking request was declined.',
		paragraphs: [],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: when }
		],
		actions: []
	};
	const admin: EmailContent = {
		brand,
		subject: `Declined: ${eventName} from ${a.attendee_name}`,
		heading: 'Booking declined',
		paragraphs: [`You declined the request from ${a.attendee_name} <${a.attendee_email}>.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: when }
		],
		actions: []
	};

	return [attendeeMessage(i, attendee), organizerMessage(i, admin)];
}
