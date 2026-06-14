import { deriveBrand, eventTypeName, fmtWhen } from '../format.js';
import { requestIcs } from '../ics.js';
import { attendeeMessage, organizerMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingRescheduledByOrganizer(i: BookingEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);

	const attendee: EmailContent = {
		brand,
		subject: `Rescheduled: ${eventName} with ${brand.name}`,
		heading: `${brand.name} moved this booking to a new time.`,
		paragraphs: [],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: when },
			{ label: 'Where', value: a.location }
		],
		actions: [{ href: i.links.booked, label: 'View this booking', variant: 'primary' }],
		previewText: `Now scheduled for ${when}.`
	};
	const admin: EmailContent = {
		brand,
		subject: `Rescheduled: ${eventName} with ${a.attendee_name}`,
		heading: 'Booking rescheduled',
		paragraphs: [`You rescheduled the booking for ${a.attendee_name} <${a.attendee_email}>.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: when }
		],
		actions: [],
		previewText: `Now scheduled for ${when}.`
	};

	return [attendeeMessage(i, attendee, requestIcs(i, i.links.booked)), organizerMessage(i, admin)];
}
