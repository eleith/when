import type { Attachment, Envelope } from './send';
import type { BookingEmailInput } from './types';

export interface EnvelopeSpec {
	subject: string;
	html: string;
	text: string;
	ics?: Attachment;
}

function envelope(to: string, spec: EnvelopeSpec): Envelope {
	return {
		to,
		subject: spec.subject,
		text: spec.text,
		html: spec.html,
		attachments: spec.ics ? [spec.ics] : undefined
	};
}

/** Envelope addressed to the booking's attendee. */
export function attendeeEnvelope(
	i: Pick<BookingEmailInput, 'appointment'>,
	spec: EnvelopeSpec
): Envelope {
	return envelope(i.appointment.attendee_email, spec);
}

/** Envelope addressed to the organizer (the single configured user). */
export function organizerEnvelope(i: Pick<BookingEmailInput, 'cfg'>, spec: EnvelopeSpec): Envelope {
	return envelope(i.cfg.user.email, spec);
}
