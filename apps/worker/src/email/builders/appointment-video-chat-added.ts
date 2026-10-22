import {
	answerRows,
	deriveBrand,
	eventTypeName,
	guestLabel,
	whenForGuest,
	whenForHost
} from '../format.js';
import { requestIcs } from '../ics.js';
import {
	guestMessage,
	hostMessage,
	messages,
	type AppointmentEmailMessage
} from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { AppointmentEmailInput } from '../types.js';

export function appointmentVideoChatAdded(i: AppointmentEmailInput): AppointmentEmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const guestWhen = whenForGuest(i);
	const hostWhen = whenForHost(i);
	const details = [
		{ label: 'Where', value: a.location },
		...(a.video_chat ? [{ label: 'Video link', value: a.video_chat }] : []),
		...(a.note ? [{ label: 'Note', value: a.note }] : [])
	];

	const guest: EmailContent = {
		brand,
		subject: `Video link added: ${eventName} with ${brand.name}`,
		heading: 'Video link added to appointment',
		paragraphs: ['A video link was added to your appointment.'],
		rows: [{ label: 'What', value: eventName }, { label: 'When', value: guestWhen }, ...details],
		actions: [{ href: i.links.booked, label: 'View this appointment' }],
		previewText: `A video link was added to your appointment on ${guestWhen}.`
	};
	const host: EmailContent = {
		brand,
		subject: `Video link added: ${eventName} with ${a.guest_name}`,
		heading: 'Video link added to appointment',
		paragraphs: [`A video link was added to the appointment with ${guestLabel(a)}.`],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: hostWhen },
			...details,
			...answerRows(a)
		],
		actions: [],
		previewText: `A video link was added to the appointment on ${hostWhen}.`
	};

	return messages(
		a.status === 'confirmed' ? guestMessage(i, guest, requestIcs(i, i.links.booked)) : null,
		hostMessage(i, host)
	);
}
