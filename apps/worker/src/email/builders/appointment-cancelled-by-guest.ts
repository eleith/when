import {
	answerRows,
	guestLabel,
	deriveBrand,
	eventTypeName,
	whenForGuest,
	whenForHost
} from '../format.js';
import { cancelIcs } from '../ics.js';
import { guestMessage, messages, hostMessage, type EmailMessage } from '../recipients.js';
import type { EmailContent } from '../content.js';
import type { AppointmentEmailInput } from '../types.js';

import { parseActionLog, type Appointment } from '@when/db';

function reasonParagraph(a: Appointment): string[] {
	const log = parseActionLog(a.action_log);
	const cancel = log.findLast((e) => e.action === 'cancel');
	return cancel?.payload?.note ? [`Reason: ${cancel.payload.note}`] : [];
}

export function appointmentCancelledByGuest(i: AppointmentEmailInput): EmailMessage[] {
	const a = i.appointment;
	const brand = deriveBrand(i.cfg, i.logo?.cid);
	const eventName = eventTypeName(i.eventType, a);
	const guestWhen = whenForGuest(i);
	const hostWhen = whenForHost(i);

	const guest: EmailContent = {
		brand,
		subject: `Cancelled: ${eventName} with ${brand.name}`,
		heading: 'Your appointment has been cancelled.',
		paragraphs: reasonParagraph(a),
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: guestWhen }
		],
		actions: [],
		previewText: `Was scheduled for ${guestWhen}.`
	};
	const admin: EmailContent = {
		brand,
		subject: `Cancelled: ${eventName} with ${a.guest_name}`,
		heading: 'Appointment cancelled',
		paragraphs: [`${guestLabel(a)} cancelled this appointment.`, ...reasonParagraph(a)],
		rows: [
			{ label: 'What', value: eventName },
			{ label: 'When', value: hostWhen },
			...answerRows(a)
		],
		actions: [],
		previewText: `Was scheduled for ${hostWhen}.`
	};

	return messages(guestMessage(i, guest, cancelIcs(i, i.links.booked)), hostMessage(i, admin));
}
