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
import { parseActionLog } from '@when/db';

export function appointmentEditedByHost(i: AppointmentEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const guestWhen = whenForGuest(i);
	const hostWhen = whenForHost(i);

	const actionLog = parseActionLog(a.action_log);
	const editEntry = actionLog.findLast((e) => e.action === 'edit');
	const changes = (editEntry?.payload?.metadata?.changes as string[]) || [];

	const paragraphs: string[] = [];
	if (changes.includes('note_added')) {
		paragraphs.push('A note was added to your appointment.');
	} else if (changes.includes('note_updated')) {
		paragraphs.push('The note on your appointment was updated.');
	} else if (changes.includes('note_removed')) {
		paragraphs.push('The note on your appointment was removed.');
	} else {
		paragraphs.push('The details of your appointment were updated.');
	}

	const isConfirmed = a.status === 'confirmed';

	const guestRows = [
		{ label: 'What', value: eventName },
		{ label: 'When', value: guestWhen },
		{ label: 'Where', value: a.location },
		...(isConfirmed && a.note ? [{ label: 'Note', value: a.note }] : [])
	];

	const hostRows = [
		{ label: 'What', value: eventName },
		{ label: 'When', value: hostWhen },
		{ label: 'Where', value: a.location },
		...(a.note ? [{ label: 'Note', value: a.note }] : []),
		...answerRows(a)
	];

	const hostParagraphs = [`You updated the details for the appointment with ${guestLabel(a)}.`];

	const guestEmail = {
		subject: '',
		heading: '',
		previewText: ''
	};
	const hostEmail = {
		subject: '',
		heading: '',
		previewText: ''
	};

	if (changes.includes('note_added')) {
		guestEmail.subject = `Note added: ${eventName} with ${brand.name}`;
		guestEmail.heading = 'Note added to appointment';
		guestEmail.previewText = `A note was added to your appointment on ${guestWhen}.`;

		hostEmail.subject = `Note added: ${eventName} with ${a.guest_name}`;
		hostEmail.heading = 'Note added to appointment';
		hostEmail.previewText = `You added a note to the appointment on ${hostWhen}.`;
	} else if (changes.includes('note_updated')) {
		guestEmail.subject = `Note updated: ${eventName} with ${brand.name}`;
		guestEmail.heading = 'Note updated for appointment';
		guestEmail.previewText = `The note on your appointment on ${guestWhen} was updated.`;

		hostEmail.subject = `Note updated: ${eventName} with ${a.guest_name}`;
		hostEmail.heading = 'Note updated for appointment';
		hostEmail.previewText = `You updated the note on the appointment on ${hostWhen}.`;
	} else if (changes.includes('note_removed')) {
		guestEmail.subject = `Note removed: ${eventName} with ${brand.name}`;
		guestEmail.heading = 'Note removed from appointment';
		guestEmail.previewText = `The note was removed from your appointment on ${guestWhen}.`;

		hostEmail.subject = `Note removed: ${eventName} with ${a.guest_name}`;
		hostEmail.heading = 'Note removed from appointment';
		hostEmail.previewText = `You removed the note from the appointment on ${hostWhen}.`;
	} else {
		guestEmail.subject = `Updated details: ${eventName} with ${brand.name}`;
		guestEmail.heading = 'Appointment details updated';
		guestEmail.previewText = `Details updated for your appointment on ${guestWhen}.`;

		hostEmail.subject = `Updated details: ${eventName} with ${a.guest_name}`;
		hostEmail.heading = 'Appointment details updated';
		hostEmail.previewText = `Details updated for the appointment on ${hostWhen}.`;
	}

	const guest: EmailContent = {
		brand,
		subject: guestEmail.subject,
		heading: guestEmail.heading,
		paragraphs,
		rows: guestRows,
		actions: [{ href: i.links.booked, label: 'View this appointment', variant: 'primary' }],
		previewText: guestEmail.previewText
	};

	const host: EmailContent = {
		brand,
		subject: hostEmail.subject,
		heading: hostEmail.heading,
		paragraphs: hostParagraphs,
		rows: hostRows,
		actions: [],
		previewText: hostEmail.previewText
	};

	// Only send to the guest if the appointment is confirmed (notes/details are hidden when pending)
	return messages(
		isConfirmed ? guestMessage(i, guest, requestIcs(i, i.links.booked)) : null,
		hostMessage(i, host)
	);
}
