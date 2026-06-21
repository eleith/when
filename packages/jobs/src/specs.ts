import { defineWorkflowSpec, type Workflow } from 'openworkflow';
import type { Appointment } from '@when/db';

/**
 * openworkflow exports `Workflow` but not the bare `WorkflowSpec` type, so the
 * inferred type of a `defineWorkflowSpec(...)` result can't be named for
 * declaration emit (TS2883). Recover the spec type via `Workflow['spec']`.
 */
type WorkflowSpec<Input, Output> = Workflow<Input, Output, Input>['spec'];

/**
 * Which appointment notification to send. Each value maps — in the worker — to one
 * or more email builders, and to a single `email_notification_status` outcome
 * for the appointment.
 */
export type AppointmentEmailKind =
	| 'confirmed'
	| 'pending'
	| 'cancelled-by-attendee'
	| 'cancelled-by-organizer'
	| 'rescheduled-by-attendee'
	| 'rescheduled-by-organizer'
	| 'declined';

/**
 * Self-contained input for a send-appointment-email run. Carries the appointment
 * snapshot; the worker supplies `cfg` from its own loaded config and derives the
 * event type + action links from it.
 */
export interface SendAppointmentEmailInput {
	kind: AppointmentEmailKind;
	appointment: Appointment;
}

// 'sent' = delivered; 'failed' = attempted and gave up after retries.
export type SendAppointmentEmailResult = 'sent' | 'failed';

/**
 * Producer-side contract for the send-appointment-email workflow. Web triggers runs
 * from this spec (`runWorkflow(sendAppointmentEmail, input)`); the worker provides
 * the implementation in `@when/worker`.
 */
export const sendAppointmentEmail: WorkflowSpec<
	SendAppointmentEmailInput,
	SendAppointmentEmailResult
> = defineWorkflowSpec<SendAppointmentEmailInput, SendAppointmentEmailResult>({
	name: 'send-appointment-email',
	// Workflow-level backstop for unexpected errors. SMTP send retries are set
	// per-step in the worker (the expected failure path is recorded, not thrown).
	retryPolicy: {
		maximumAttempts: 3,
		initialInterval: '1m',
		backoffCoefficient: 2,
		maximumInterval: '15m'
	}
});

/** A calendar broke (`broke`) or recovered (`recovered`); drives the owner email. */
export type OwnerAlertKind = 'broke' | 'recovered';

/**
 * Self-contained input for an owner-alert run: the raw facts of the transition.
 * The worker renders the email from these + its own config (owner address, brand).
 */
export interface SendOwnerAlertInput {
	calendarId: string;
	kind: OwnerAlertKind;
	/** When the breakage began (for `broke`); null for a recovery. */
	since: string | null;
	reason: string;
}

export type SendOwnerAlertResult = 'sent' | 'failed';

/** Producer-side contract for the owner-alert email; worker implements it. */
export const sendOwnerAlert: WorkflowSpec<SendOwnerAlertInput, SendOwnerAlertResult> =
	defineWorkflowSpec<SendOwnerAlertInput, SendOwnerAlertResult>({
		name: 'send-owner-alert',
		retryPolicy: {
			maximumAttempts: 3,
			initialInterval: '1m',
			backoffCoefficient: 2,
			maximumInterval: '15m'
		}
	});

export interface PurgeAppointmentRow {
	id: string;
	externalEventId: string | null;
	externalCalendarId: string | null;
}

export interface PurgeAppointmentInput {
	rows: PurgeAppointmentRow[];
}

export type PurgeAppointmentResult = 'purged';

export const purgeAppointment: WorkflowSpec<PurgeAppointmentInput, PurgeAppointmentResult> =
	defineWorkflowSpec<PurgeAppointmentInput, PurgeAppointmentResult>({
		name: 'purge-appointment',
		retryPolicy: {
			maximumAttempts: 3,
			initialInterval: '1m',
			backoffCoefficient: 2,
			maximumInterval: '15m'
		}
	});

export type SyncCalendarsInput = Record<string, never>;
export type SyncCalendarsResult = 'requested';

// Payload-free wake-up the worker handles by running its calendar sync.
export const syncCalendars: WorkflowSpec<SyncCalendarsInput, SyncCalendarsResult> =
	defineWorkflowSpec<SyncCalendarsInput, SyncCalendarsResult>({
		name: 'sync-calendars',
		retryPolicy: {
			maximumAttempts: 1,
			initialInterval: '1s',
			backoffCoefficient: 2,
			maximumInterval: '1s'
		}
	});
