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

	const hostParagraphs = [
		`You updated the details for the appointment with ${guestLabel(a)}.`
	];

	let guestSubject = '';
	let guestHeading = '';
	let guestPreview = '';
	let hostSubject = '';
	let hostHeading = '';
	let hostPreview = '';

	if (changes.includes('note_added')) {
		guestSubject = `Note added: ${eventName} with ${brand.name}`;
		guestHeading = 'Note added to appointment';
		guestPreview = `A note was added to your appointment on ${guestWhen}.`;

		hostSubject = `Note added: ${eventName} with ${a.guest_name}`;
		hostHeading = 'Note added to appointment';
		hostPreview = `You added a note to the appointment on ${hostWhen}.`;
	} else if (changes.includes('note_updated')) {
		guestSubject = `Note updated: ${eventName} with ${brand.name}`;
		guestHeading = 'Note updated for appointment';
		guestPreview = `The note on your appointment on ${guestWhen} was updated.`;

		hostSubject = `Note updated: ${eventName} with ${a.guest_name}`;
		hostHeading = 'Note updated for appointment';
		hostPreview = `You updated the note on the appointment on ${hostWhen}.`;
	} else if (changes.includes('note_removed')) {
		guestSubject = `Note removed: ${eventName} with ${brand.name}`;
		guestHeading = 'Note removed from appointment';
		guestPreview = `The note was removed from your appointment on ${guestWhen}.`;

		hostSubject = `Note removed: ${eventName} with ${a.guest_name}`;
		hostHeading = 'Note removed from appointment';
		hostPreview = `You removed the note from the appointment on ${hostWhen}.`;
	} else {
		guestSubject = `Updated details: ${eventName} with ${brand.name}`;
		guestHeading = 'Appointment details updated';
		guestPreview = `Details updated for your appointment on ${guestWhen}.`;

		hostSubject = `Updated details: ${eventName} with ${a.guest_name}`;
		hostHeading = 'Appointment details updated';
		hostPreview = `Details updated for the appointment on ${hostWhen}.`;
	}

	const guest: EmailContent = {
		brand,
		subject: guestSubject,
		heading: guestHeading,
		paragraphs,
		rows: guestRows,
		actions: [{ href: i.links.booked, label: 'View this appointment', variant: 'primary' }],
		previewText: guestPreview
	};

	const host: EmailContent = {
		brand,
		subject: hostSubject,
		heading: hostHeading,
		paragraphs: hostParagraphs,
		rows: hostRows,
		actions: [],
		previewText: hostPreview
	};

	// Only send to the guest if the appointment is confirmed (notes/details are hidden when pending)
	return messages(
		isConfirmed ? guestMessage(i, guest, requestIcs(i, i.links.booked)) : null,
		hostMessage(i, host)
	);
}
