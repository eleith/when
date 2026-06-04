import { deriveBrand, eventTypeName, fmtWhen } from '../format.js';
import { cancelIcs } from '../ics.js';
import { attendeeEnvelope, organizerEnvelope, type Envelope } from '../recipients.js';
import { toSpec } from '../render.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingCancelledByOrganizer(i: BookingEmailInput): Envelope[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg);
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);

	const attendee: EmailContent = {
		brand,
		heading: `${brand.name} cancelled this booking.`,
		paragraphs: [],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: when }
		],
		actions: []
	};
	const admin: EmailContent = {
		brand,
		heading: `Cancelled: ${eventName}`,
		paragraphs: [
			`You cancelled ${a.attendee_name} <${a.attendee_email}> booking for ${eventName}.`
		],
		rows: [{ label: 'When', value: when }],
		actions: []
	};

	return [
		attendeeEnvelope(
			i,
			toSpec(attendee, `Cancelled: ${eventName} with ${brand.name}`, cancelIcs(i, i.links.booked))
		),
		organizerEnvelope(i, toSpec(admin, `Cancelled: ${eventName} with ${a.attendee_name}`))
	];
}
