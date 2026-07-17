import { defineWorkflowSpec, type Workflow } from 'openworkflow';

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
 * Self-contained input for a reconcile-appointment run.
 */
export interface ReconcileAppointmentInput {
	appointmentId: string;
	emailKind?: AppointmentEmailKind;
}

// 'reconciled' = completed successfully; 'failed' = failed after retries.
export type ReconcileAppointmentResult = 'reconciled' | 'failed';

/**
 * Producer-side contract for the reconcile-appointment workflow. Web triggers runs
 * from this spec (`runWorkflow(reconcileAppointment, input)`); the worker provides
 * the implementation in `@when/worker`.
 */
export const reconcileAppointment: WorkflowSpec<
	ReconcileAppointmentInput,
	ReconcileAppointmentResult
> = defineWorkflowSpec<ReconcileAppointmentInput, ReconcileAppointmentResult>({
	name: 'reconcile-appointment',
	// Workflow-level backstop for unexpected errors.
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

export interface TestEmailInput {
	to: string;
}
export type TestEmailResult = 'sent';

// CLI-triggered: render + send a test email through the real worker pipeline.
export const testEmail: WorkflowSpec<TestEmailInput, TestEmailResult> = defineWorkflowSpec<
	TestEmailInput,
	TestEmailResult
>({
	name: 'test-email',
	retryPolicy: {
		maximumAttempts: 1,
		initialInterval: '1s',
		backoffCoefficient: 2,
		maximumInterval: '1s'
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
