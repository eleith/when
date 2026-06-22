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

export function appointmentPending(i: AppointmentEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const guestWhen = whenForGuest(i);
	const hostWhen = whenForHost(i);

	const guest: EmailContent = {
		brand,
		subject: `Appointment request received: ${eventName} with ${brand.name}`,
		heading: 'Your appointment request was received.',
		paragraphs: [`${brand.name} will review your request and email you to confirm.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: guestWhen },
			{ label: 'Where', value: a.location }
		],
		actions: [{ href: i.links.booked, label: 'View this appointment', variant: 'primary' }],
		previewText: `Requested for ${guestWhen}.`
	};
	const host: EmailContent = {
		brand,
		subject: `Appointment request: ${eventName} from ${a.guest_name}`,
		heading: 'New appointment request',
		paragraphs: [`${guestLabel(a)} requested this appointment.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: hostWhen },
			{ label: 'Where', value: a.location },
			...answerRows(a)
		],
		actions: [{ href: i.links.manage, label: 'Review request', variant: 'primary' }],
		previewText: `Requested for ${hostWhen}.`
	};

	return messages(guestMessage(i, guest), hostMessage(i, host));
}
