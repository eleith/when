import type { EmailContent } from './content.js';
import type { AppointmentEmailInput } from './types.js';

export interface Attachment {
	filename: string;
	content: string;
	contentType: string;
	cid?: string;
	encoding?: string;
}

/** A fully-addressed, rendered email ready for SMTP. */
export interface Envelope {
	to: string;
	subject: string;
	text: string;
	html?: string;
	attachments?: Attachment[];
}

/** A builder's pure output: an addressed content model, not yet rendered. */
export interface EmailMessage {
	to: string;
	content: EmailContent;
	ics?: Attachment;
}

export type RecipientRole = 'host' | 'guest';

export interface AppointmentEmailMessage extends EmailMessage {
	role: RecipientRole;
}

export interface PreparedAppointmentEmail {
	role: RecipientRole;
	envelope: Envelope;
}

/** Message addressed to the appointment's guest, or null when no email was collected. */
export function guestMessage(
	i: Pick<AppointmentEmailInput, 'appointment'>,
	content: EmailContent,
	ics?: Attachment
): AppointmentEmailMessage | null {
	if (!i.appointment.guest_email) return null;
	return { role: 'guest', to: i.appointment.guest_email, content, ics };
}

/** Message addressed to the host (the single configured user). */
export function hostMessage(
	i: Pick<AppointmentEmailInput, 'cfg'>,
	content: EmailContent
): AppointmentEmailMessage {
	return { role: 'host', to: i.cfg.user.email, content };
}

/** Collect a builder's messages, dropping any that had no recipient (e.g. no guest email). */
export function messages(...list: (AppointmentEmailMessage | null)[]): AppointmentEmailMessage[] {
	return list.filter((m): m is AppointmentEmailMessage => m !== null);
}
