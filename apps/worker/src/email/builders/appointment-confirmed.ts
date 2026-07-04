import {
	answerRows,
	guestLabel,
	deriveBrand,
	eventTypeName,
	whenForGuest,
	whenForHost
} from '../format.js';
import { requestIcs } from '../ics.js';
import { guestMessage, messages, hostMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { AppointmentEmailInput } from '../types.js';

export function appointmentConfirmed(i: AppointmentEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const guestWhen = whenForGuest(i);
	const hostWhen = whenForHost(i);

	const guest: EmailContent = {
		brand,
		subject: `Confirmed: ${eventName} with ${brand.name}`,
		heading: 'Your appointment is confirmed.',
		paragraphs: [],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: guestWhen },
			{ label: 'Where', value: a.location },
			...(a.video_chat ? [{ label: 'Video link', value: a.video_chat }] : [])
		],
		actions: [{ href: i.links.booked, label: 'View this appointment', variant: 'primary' }],
		previewText: `See you on ${guestWhen}.`
	};
	const admin: EmailContent = {
		brand,
		subject: `New appointment: ${eventName} with ${a.guest_name}`,
		heading: 'New appointment',
		paragraphs: [`${guestLabel(a)} just scheduled an appointment.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: hostWhen },
			{ label: 'Where', value: a.location },
			...(a.video_chat ? [{ label: 'Video link', value: a.video_chat }] : []),
			...answerRows(a)
		],
		actions: [],
		previewText: `Scheduled for ${hostWhen}.`
	};

	return messages(guestMessage(i, guest, requestIcs(i, i.links.booked)), hostMessage(i, admin));
}
