import type { Envelope, NotifyContext, NotifyVariant } from '../notify';
import { renderBookingCancelledByAttendee } from './booking-cancelled-by-attendee';
import { renderBookingCancelledByOrganizer } from './booking-cancelled-by-organizer';
import { renderBookingConfirmed } from './booking-confirmed';
import { renderBookingDeclined } from './booking-declined';
import { renderBookingPendingToAttendee } from './booking-pending-to-attendee';
import { renderBookingPendingToOrganizer } from './booking-pending-to-organizer';
import { renderBookingRescheduledByAttendee } from './booking-rescheduled-by-attendee';
import { renderBookingRescheduledByOrganizer } from './booking-rescheduled-by-organizer';

export {
	renderBookingCancelledByAttendee,
	renderBookingCancelledByOrganizer,
	renderBookingConfirmed,
	renderBookingDeclined,
	renderBookingPendingToAttendee,
	renderBookingPendingToOrganizer,
	renderBookingRescheduledByAttendee,
	renderBookingRescheduledByOrganizer
};

export type VariantRenderer = (ctx: NotifyContext) => Envelope[];

export const renderers: Record<NotifyVariant, VariantRenderer> = {
	booking_confirmed: renderBookingConfirmed,
	booking_pending_to_organizer: renderBookingPendingToOrganizer,
	booking_pending_to_attendee: renderBookingPendingToAttendee,
	booking_cancelled_by_attendee: renderBookingCancelledByAttendee,
	booking_cancelled_by_organizer: renderBookingCancelledByOrganizer,
	booking_rescheduled_by_attendee: renderBookingRescheduledByAttendee,
	booking_rescheduled_by_organizer: renderBookingRescheduledByOrganizer,
	booking_declined: renderBookingDeclined
};
