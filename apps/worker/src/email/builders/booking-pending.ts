import { deriveBrand, eventTypeName, fmtWhen } from '../format.js';
import { attendeeEnvelope, organizerEnvelope, type Envelope } from '../recipients.js';
import { toSpec } from '../render.js';
import type { EmailContent } from '../content.js';
import type { BookingEmailInput } from '../types.js';

export function bookingPending(i: BookingEmailInput): Envelope[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg);
	const eventName = eventTypeName(i.eventType, a);
	const when = fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);
	const duration = i.eventType ? `${i.eventType.duration} min` : null;

	const attendee: EmailContent = {
		brand,
		heading: `Booking request received: ${eventName}`,
		paragraphs: [
			`${brand.name} will review and confirm. You'll get a follow-up email at ${a.attendee_email} with the outcome.`,
			'Need to change something before then?'
		],
		rows: [
			{ label: 'When', value: when },
			{ label: 'Where', value: a.location }
		],
		actions: [
			{ href: i.links.reschedule, label: 'Reschedule', variant: 'secondary' },
			{ href: i.links.cancel, label: 'Cancel', variant: 'danger' }
		],
		footerHref: i.links.booked
	};
	const organizer: EmailContent = {
		brand,
		heading: `Booking request: ${eventName}`,
		paragraphs: [`${a.attendee_name} <${a.attendee_email}> has requested to book ${eventName}.`],
		rows: [
			{ label: 'When', value: when },
			{ label: 'Duration', value: duration },
			{ label: 'Where', value: a.location }
		],
		actions: [{ href: i.links.manage, label: 'Review request', variant: 'primary' }]
	};

	return [
		attendeeEnvelope(
			i,
			toSpec(attendee, `Booking request received: ${eventName} with ${brand.name}`)
		),
		organizerEnvelope(i, toSpec(organizer, `Booking request: ${eventName} from ${a.attendee_name}`))
	];
}
