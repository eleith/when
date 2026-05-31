import { buildIcs } from '../ics';
import { eventTypeName } from './format';
import type { Attachment } from './send';
import type { BookingEmailInput } from './types';

/** A `METHOD:REQUEST` invite for a confirmed booking (attendee attachment). */
export function requestIcs(i: BookingEmailInput, bookedUrl: string): Attachment {
	return {
		filename: `${i.appointment.id}.ics`,
		content: buildIcs({
			appointment: { ...i.appointment, status: 'confirmed' },
			eventTypeName: eventTypeName(i.eventType, i.appointment),
			organizerName: i.cfg.user.name,
			organizerEmail: i.cfg.user.email,
			cancelUrl: bookedUrl,
			method: 'REQUEST'
		}),
		contentType: 'text/calendar; charset=utf-8'
	};
}
