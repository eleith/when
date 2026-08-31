import { buildIcs, type IcsInput, type IcsMethod } from '@when/calendar';
import { senderEmail } from '@when/config';
import { eventTypeName } from './format.js';
import type { Attachment } from './recipients.js';
import type { AppointmentEmailInput } from './types.js';

export { buildIcs, type IcsInput, type IcsMethod };

function icsAttachment(input: IcsInput): Attachment {
	return {
		filename: 'invite.ics',
		content: buildIcs(input),
		contentType: 'text/calendar; charset=utf-8'
	};
}

/** A `METHOD:REQUEST` invite for a confirmed appointment (guest attachment). */
export function requestIcs(i: AppointmentEmailInput, bookedUrl: string): Attachment {
	return icsAttachment({
		appointment: { ...i.appointment, status: 'confirmed' },
		eventTypeName: eventTypeName(i.eventType, i.appointment),
		hostName: i.cfg.user.name,
		hostEmail: senderEmail(i.cfg),
		cancelUrl: bookedUrl,
		method: 'REQUEST'
	});
}

/** A `METHOD:CANCEL` invite for a cancelled appointment (guest attachment). */
export function cancelIcs(i: AppointmentEmailInput, bookedUrl: string): Attachment {
	return icsAttachment({
		appointment: i.appointment,
		eventTypeName: eventTypeName(i.eventType, i.appointment),
		hostName: i.cfg.user.name,
		hostEmail: senderEmail(i.cfg),
		cancelUrl: bookedUrl,
		method: 'CANCEL'
	});
}
