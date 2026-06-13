import type { WhenConfiguration } from '@when/config';
import type { SendBookingEmailInput } from '@when/jobs';
import { bookingCancelledByAttendee } from './builders/booking-cancelled-by-attendee.js';
import { bookingCancelledByOrganizer } from './builders/booking-cancelled-by-organizer.js';
import { bookingConfirmed } from './builders/booking-confirmed.js';
import { bookingDeclined } from './builders/booking-declined.js';
import { bookingPending } from './builders/booking-pending.js';
import { bookingRescheduledByAttendee } from './builders/booking-rescheduled-by-attendee.js';
import { bookingRescheduledByOrganizer } from './builders/booking-rescheduled-by-organizer.js';
import type { Envelope } from './recipients.js';
import { bookingLinks } from '../links.js';
import { fetchBrandLogo } from './logo.js';
import type { BookingEmailInput } from './types.js';

function build(i: BookingEmailInput, kind: SendBookingEmailInput['kind']): Envelope[] {
	switch (kind) {
		case 'confirmed':
			return bookingConfirmed(i);
		case 'pending':
			return bookingPending(i);
		case 'cancelled-by-attendee':
			return bookingCancelledByAttendee(i);
		case 'cancelled-by-organizer':
			return bookingCancelledByOrganizer(i);
		case 'rescheduled-by-attendee':
			return bookingRescheduledByAttendee(i);
		case 'rescheduled-by-organizer':
			return bookingRescheduledByOrganizer(i);
		case 'declined':
			return bookingDeclined(i);
		default: {
			const unhandled: never = kind;
			throw new Error(`unhandled booking email kind: ${String(unhandled)}`);
		}
	}
}

export async function dispatch(
	input: SendBookingEmailInput,
	cfg: WhenConfiguration
): Promise<Envelope[]> {
	const eventType = cfg.event_types.find((e) => e.id === input.appointment.event_type_id);
	const logo = await fetchBrandLogo(cfg);
	const i: BookingEmailInput = {
		cfg,
		appointment: input.appointment,
		eventType,
		links: bookingLinks({ baseUrl: cfg.url.app, appointment: input.appointment, eventType }),
		logo
	};

	const envelopes = build(i, input.kind);
	if (!logo) return envelopes;
	return envelopes.map((e) => ({ ...e, attachments: [...(e.attachments ?? []), logo] }));
}
