import type { EventType, WhenConfiguration } from './config/schema';
import type { Appointment } from './db';
import { renderers } from './email-templates';
import { sendEmails, type SendResult } from './email/send';

// Re-exported so the existing renderers (which import from '../notify') keep working
// during the migration to typed email builders.
export type { Envelope, Attachment } from './email/send';

export type NotifyVariant =
	| 'booking_confirmed'
	| 'booking_pending_to_organizer'
	| 'booking_pending_to_attendee'
	| 'booking_cancelled_by_attendee'
	| 'booking_cancelled_by_organizer'
	| 'booking_rescheduled_by_attendee'
	| 'booking_rescheduled_by_organizer'
	| 'booking_declined';

export interface NotifyContext {
	cfg: WhenConfiguration;
	appointment: Appointment;
	eventType: EventType | undefined;
	/** Public cancel deep link: `/booked/[id]?token=…&cancel=1`. Empty for variants that don't surface it. */
	cancelUrl: string;
	/** Public reschedule route: `/booked/[id]/reschedule?token=…`. Empty for variants that don't surface it. */
	rescheduleUrl: string;
	/** Public booking landing page: `/booked/[id]?token=…`. Empty for variants that don't surface it. */
	bookedUrl: string;
	/** Login-gated organizer review link — set for `booking_pending_to_organizer`. */
	manageUrl?: string;
}

export type NotifyResult = SendResult;

export async function notify(variant: NotifyVariant, ctx: NotifyContext): Promise<NotifyResult> {
	return sendEmails(ctx.cfg, renderers[variant](ctx));
}
