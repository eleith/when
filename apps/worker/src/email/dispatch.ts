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
import type { BookingEmailInput } from './types.js';

export function dispatch(input: SendBookingEmailInput, cfg: WhenConfiguration): Envelope[] {
	const i: BookingEmailInput = {
		cfg,
		appointment: input.appointment,
		eventType: input.eventType,
		links: input.links
	};

	switch (input.kind) {
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
			const unhandled: never = input.kind;
			throw new Error(`unhandled booking email kind: ${String(unhandled)}`);
		}
	}
}
