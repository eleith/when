import { defineWorkflowSpec } from 'openworkflow';
import type { Appointment } from '@when/db';
import type { EventType } from '@when/config';

/**
 * Which booking notification to send. Each value maps — in the worker — to one
 * or more email builders, and to a single `notification_status.email` outcome
 * for the appointment.
 */
export type BookingEmailKind =
	| 'confirmed'
	| 'pending'
	| 'cancelled-by-attendee'
	| 'cancelled-by-organizer'
	| 'rescheduled-by-attendee'
	| 'rescheduled-by-organizer'
	| 'declined';

/**
 * Self-contained input for a send-booking-email run. Carries the rendered
 * appointment snapshot so the worker never re-reads the DB to render; the
 * worker supplies `cfg` from its own loaded config.
 */
export interface SendBookingEmailInput {
	kind: BookingEmailKind;
	appointment: Appointment;
	eventType: EventType | undefined;
	baseUrl: string;
}

export type SendBookingEmailResult = 'sent' | 'skipped';

/**
 * Producer-side contract for the send-booking-email workflow. Web triggers runs
 * from this spec (`runWorkflow(sendBookingEmail, input)`); the worker provides
 * the implementation in `@when/worker`.
 */
export const sendBookingEmail = defineWorkflowSpec<SendBookingEmailInput, SendBookingEmailResult>({
	name: 'send-booking-email'
});
