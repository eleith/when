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

export function appointmentRescheduledByHost(i: AppointmentEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const guestWhen = whenForGuest(i);
	const hostWhen = whenForHost(i);
	const guestRows = [
		{ label: 'What', value: eventName },
		{ label: 'When', value: guestWhen },
		{ label: 'Where', value: a.location }
	];
	const hostRows = [
		{ label: 'What', value: eventName },
		{ label: 'When', value: hostWhen },
		...answerRows(a)
	];

	if (a.status === 'pending') {
		const guest: EmailContent = {
			brand,
			subject: `New time proposed: ${eventName} with ${brand.name}`,
			heading: `${brand.name} proposed a new time for your request.`,
			paragraphs: [
				`${brand.name} will confirm the new time and email you.`,
				...(i.rescheduleReason ? [`Reason for rescheduling: ${i.rescheduleReason}`] : [])
			],
			rows: guestRows,
			actions: [{ href: i.links.booked, label: 'View this appointment', variant: 'primary' }],
			previewText: `Requested for ${guestWhen}.`
		};
		const host: EmailContent = {
			brand,
			subject: `Rescheduled: ${eventName} with ${a.guest_name}`,
			heading: 'Appointment rescheduled',
			paragraphs: [
				`You moved the pending request for ${guestLabel(a)} to a new time.`,
				...(i.rescheduleReason ? [`Reason for rescheduling: ${i.rescheduleReason}`] : [])
			],
			rows: hostRows,
			actions: [],
			previewText: `Requested for ${hostWhen}.`
		};
		return messages(guestMessage(i, guest), hostMessage(i, host));
	}

	const guest: EmailContent = {
		brand,
		subject: `Rescheduled: ${eventName} with ${brand.name}`,
		heading: `${brand.name} moved this appointment to a new time.`,
		paragraphs: i.rescheduleReason ? [`Reason for rescheduling: ${i.rescheduleReason}`] : [],
		rows: guestRows,
		actions: [{ href: i.links.booked, label: 'View this appointment', variant: 'primary' }],
		previewText: `Now scheduled for ${guestWhen}.`
	};
	const host: EmailContent = {
		brand,
		subject: `Rescheduled: ${eventName} with ${a.guest_name}`,
		heading: 'Appointment rescheduled',
		paragraphs: [
			`You rescheduled the appointment for ${guestLabel(a)}.`,
			...(i.rescheduleReason ? [`Reason for rescheduling: ${i.rescheduleReason}`] : [])
		],
		rows: hostRows,
		actions: [],
		previewText: `Now scheduled for ${hostWhen}.`
	};
	return messages(guestMessage(i, guest, requestIcs(i, i.links.booked)), hostMessage(i, host));
}
