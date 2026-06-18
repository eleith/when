import type { EmailContent } from './content.js';
import type { BookingEmailInput } from './types.js';

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

/** Message addressed to the booking's attendee, or null when no email was collected. */
export function attendeeMessage(
	i: Pick<BookingEmailInput, 'appointment'>,
	content: EmailContent,
	ics?: Attachment
): EmailMessage | null {
	if (!i.appointment.attendee_email) return null;
	return { to: i.appointment.attendee_email, content, ics };
}

/** Message addressed to the organizer (the single configured user). */
export function organizerMessage(
	i: Pick<BookingEmailInput, 'cfg'>,
	content: EmailContent
): EmailMessage {
	return { to: i.cfg.user.email, content };
}
