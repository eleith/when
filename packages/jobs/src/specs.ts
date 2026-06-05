import { defineWorkflowSpec, type Workflow } from 'openworkflow';
import type { Appointment } from '@when/db';
import type { EventType } from '@when/config';

/**
 * openworkflow exports `Workflow` but not the bare `WorkflowSpec` type, so the
 * inferred type of a `defineWorkflowSpec(...)` result can't be named for
 * declaration emit (TS2883). Recover the spec type via `Workflow['spec']`.
 */
type WorkflowSpec<Input, Output> = Workflow<Input, Output, Input>['spec'];

/**
 * Which booking notification to send. Each value maps — in the worker — to one
 * or more email builders, and to a single `email_notification_status` outcome
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
 * Action URLs for a booking. Web is the source of truth for these (it owns
 * routing), computes them at enqueue time, and passes them in the payload so the
 * worker doesn't need to know web's URL structure.
 */
export interface BookingLinks {
	/** Booking landing page. */
	booked: string;
	/** Landing page with the cancel dialog open. */
	cancel: string;
	/** Reschedule flow (falls back to the landing page if the event type is gone). */
	reschedule: string;
	/** Sign-in deep link back to the booking (organizer review). */
	manage: string;
}

/**
 * Self-contained input for a send-booking-email run. Carries the appointment
 * snapshot and the precomputed links so the worker neither re-reads the DB nor
 * knows web's routing; the worker supplies `cfg` from its own loaded config.
 */
export interface SendBookingEmailInput {
	kind: BookingEmailKind;
	appointment: Appointment;
	eventType: EventType | undefined;
	links: BookingLinks;
}

export type SendBookingEmailResult = 'sent' | 'skipped';

/**
 * Producer-side contract for the send-booking-email workflow. Web triggers runs
 * from this spec (`runWorkflow(sendBookingEmail, input)`); the worker provides
 * the implementation in `@when/worker`.
 */
export const sendBookingEmail: WorkflowSpec<SendBookingEmailInput, SendBookingEmailResult> =
	defineWorkflowSpec<SendBookingEmailInput, SendBookingEmailResult>({
		name: 'send-booking-email',
		// Workflow-level backstop for unexpected errors. SMTP send retries are set
		// per-step in the worker (the expected failure path is recorded, not thrown).
		retryPolicy: {
			maximumAttempts: 3,
			initialInterval: '1m',
			backoffCoefficient: 2,
			maximumInterval: '15m'
		}
	});
