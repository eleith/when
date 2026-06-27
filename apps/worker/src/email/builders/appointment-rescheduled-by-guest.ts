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

export function appointmentRescheduledByGuest(i: AppointmentEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const guestWhen = whenForGuest(i);
	const hostWhen = whenForHost(i);
	const guestRows = [
		{ label: 'What', value: eventName },
		{ label: 'When', value: guestWhen },
		{ label: 'Where', value: a.location },
		...(a.conference ? [{ label: 'Video link', value: a.conference }] : [])
	];
	const hostRows = [
		{ label: 'What', value: eventName },
		{ label: 'When', value: hostWhen },
		...answerRows(a)
	];

	if (a.status === 'pending') {
		const guest: EmailContent = {
			brand,
			subject: `Reschedule requested: ${eventName} with ${brand.name}`,
			heading: 'Your reschedule request was received.',
			paragraphs: [
				`${brand.name} will review the new time and email you to confirm.`,
				...(i.rescheduleReason ? [`Reason for rescheduling: ${i.rescheduleReason}`] : [])
			],
			rows: guestRows,
			actions: [{ href: i.links.booked, label: 'View this appointment', variant: 'primary' }],
			previewText: `Requested for ${guestWhen}.`
		};
		const host: EmailContent = {
			brand,
			subject: `Reschedule request: ${eventName} from ${a.guest_name}`,
			heading: 'Reschedule request',
			paragraphs: [
				`${guestLabel(a)} asked to move this appointment to a new time.`,
				...(i.rescheduleReason ? [`Reason for rescheduling: ${i.rescheduleReason}`] : [])
			],
			rows: hostRows,
			actions: [{ href: i.links.manage, label: 'Review request', variant: 'primary' }],
			previewText: `Requested for ${hostWhen}.`
		};
		return messages(guestMessage(i, guest), hostMessage(i, host));
	}

	const guest: EmailContent = {
		brand,
		subject: `Rescheduled: ${eventName} with ${brand.name}`,
		heading: 'Your appointment moved to a new time.',
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
			`${guestLabel(a)} rescheduled this appointment.`,
			...(i.rescheduleReason ? [`Reason for rescheduling: ${i.rescheduleReason}`] : [])
		],
		rows: hostRows,
		actions: [],
		previewText: `Now scheduled for ${hostWhen}.`
	};
	return messages(guestMessage(i, guest, requestIcs(i, i.links.booked)), hostMessage(i, host));
}
