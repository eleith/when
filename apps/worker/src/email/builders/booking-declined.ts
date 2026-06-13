import { deriveBrand, eventTypeName, fmtWhen } from '../format.js';
import { attendeeEnvelope, organizerEnvelope, type Envelope } from '../recipients.js';
import { toSpec } from '../render.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingDeclined(i: BookingEmailInput): Envelope[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);

	const attendee: EmailContent = {
		brand,
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
		heading: `Declined: ${eventName}`,
		paragraphs: [`You declined the request from ${a.attendee_name} <${a.attendee_email}>.`],
		rows: [{ label: 'When', value: when }],
		actions: []
	};

	return [
		attendeeEnvelope(i, toSpec(attendee, `Declined: ${eventName} with ${brand.name}`)),
		organizerEnvelope(i, toSpec(admin, `Declined: ${eventName} from ${a.attendee_name}`))
	];
}
