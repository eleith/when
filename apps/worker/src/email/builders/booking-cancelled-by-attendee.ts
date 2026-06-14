import { deriveBrand, eventTypeName, fmtWhen } from '../format.js';
import { cancelIcs } from '../ics.js';
import { attendeeMessage, organizerMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingCancelledByAttendee(i: BookingEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);

	const attendee: EmailContent = {
		brand,
		subject: `Cancelled: ${eventName} with ${brand.name}`,
		heading: 'Your booking has been cancelled.',
		paragraphs: [],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: when }
		],
		actions: [],
		previewText: `Your booking for ${eventName} on ${when} has been cancelled.`
	};
	const admin: EmailContent = {
		brand,
		subject: `Cancelled: ${eventName} with ${a.attendee_name}`,
		heading: 'Booking cancelled',
		paragraphs: [`${a.attendee_name} <${a.attendee_email}> cancelled this booking.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: when }
		],
		actions: [],
		previewText: `${a.attendee_name} cancelled their booking for ${eventName} on ${when}.`
	};

	return [attendeeMessage(i, attendee, cancelIcs(i, i.links.booked)), organizerMessage(i, admin)];
}
