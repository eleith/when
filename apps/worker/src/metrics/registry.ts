import { Counter, Histogram, Gauge, Registry } from '@prometheus-io/client';

export const register = new Registry();
register.setDefaultLabels({ app: 'when', service: 'worker' });

export const jobsTotal = new Counter({
	name: 'when_jobs_total',
	help: 'Handler executions by return or escape (including durable suspension), not terminal workflow outcomes.',
	labelNames: ['job_name', 'status'],
	registers: [register]
});

export const jobDuration = new Histogram({
	name: 'when_job_duration_seconds',
	help: 'Duration of each workflow handler execution, including executions that durably suspend.',
	labelNames: ['job_name'],
	registers: [register]
});

export const jobsActive = new Gauge({
	name: 'when_jobs_active',
	help: 'Number of active workflow handler executions; durably suspended runs are excluded.',
	labelNames: ['job_name'],
	registers: [register]
});

export const emailsTotal = new Counter({
	name: 'when_emails_total',
	help: 'Physical appointment SMTP send attempts by outcome, not unique email deliveries.',
	labelNames: ['recipient_type', 'status', 'email_kind'],
	registers: [register]
});

export const calendarSyncTotal = new Counter({
	name: 'when_calendar_sync_total',
	help: 'Calendar scan callback outcomes, not proof that every appointment write succeeded.',
	labelNames: ['status'],
	registers: [register]
});

export const calendarSyncDuration = new Histogram({
	name: 'when_calendar_sync_duration_seconds',
	help: 'Duration of each appointment calendar reconciliation attempt.',
	labelNames: ['provider_type'],
	registers: [register]
});

export const calendarRefreshTotal = new Counter({
	name: 'when_calendar_refresh_total',
	help: 'Total number of calendar refreshes.',
	labelNames: ['calendar_id', 'provider_type', 'status'],
	registers: [register]
});

export const appointmentOperationsTotal = new Counter({
	name: 'when_appointment_operations_total',
	help: 'Appointment operation outcomes, not committed changes.',
	labelNames: ['action', 'actor', 'status'],
	registers: [register]
});

export const operationFailuresTotal = new Counter({
	name: 'when_operation_failures_total',
	help: 'Failed operation attempts by bounded operation and failure code.',
	labelNames: ['operation', 'code'],
	registers: [register]
});
