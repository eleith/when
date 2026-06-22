import {
	answerRows,
	guestLabel,
	deriveBrand,
	eventTypeName,
	whenForGuest,
	whenForHost
} from '../format.js';
import { guestMessage, messages, hostMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { AppointmentEmailInput } from '../types.js';

export function appointmentDeclined(i: AppointmentEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const guestWhen = whenForGuest(i);
	const hostWhen = whenForHost(i);

	const guest: EmailContent = {
		brand,
		subject: `Declined: ${eventName} with ${brand.name}`,
		heading: 'Your appointment request was declined.',
		paragraphs: [],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: guestWhen }
		],
		actions: [],
		previewText: `Was requested for ${guestWhen}.`
	};
	const admin: EmailContent = {
		brand,
		subject: `Declined: ${eventName} from ${a.guest_name}`,
		heading: 'Appointment declined',
		paragraphs: [`You declined the request from ${guestLabel(a)}.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: hostWhen },
			...answerRows(a)
		],
		actions: [],
		previewText: `Was requested for ${hostWhen}.`
	};

	return messages(guestMessage(i, guest), hostMessage(i, admin));
}
