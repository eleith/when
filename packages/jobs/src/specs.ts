import { defineWorkflowSpec, type Workflow } from 'openworkflow';
import type { Appointment } from '@when/db';

/**
 * openworkflow exports `Workflow` but not the bare `WorkflowSpec` type, so the
 * inferred type of a `defineWorkflowSpec(...)` result can't be named for
 * declaration emit (TS2883). Recover the spec type via `Workflow['spec']`.
 */
type WorkflowSpec<Input, Output> = Workflow<Input, Output, Input>['spec'];

// Which appointment notification to send; each value maps to one or more email
// builders in the worker.
export type AppointmentEmailKind =
	| 'confirmed'
	| 'pending'
	| 'cancelled-by-guest'
	| 'cancelled-by-host'
	| 'rescheduled-by-guest'
	| 'rescheduled-by-host'
	| 'declined'
	| 'edited-by-host';

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
