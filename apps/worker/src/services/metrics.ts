import { collectDefaultMetrics, Counter, Histogram, Gauge, Registry } from 'prom-client';
import { getOpenWorkflow } from '@when/jobs';
import type { OpenWorkflow, Workflow } from 'openworkflow';

type WorkflowSpec<Input, Output> = Workflow<Input, Output, Input>['spec'];

export const register = new Registry();
register.setDefaultLabels({ app: 'when', service: 'worker' });

collectDefaultMetrics({ register });

// Prune low-value default metrics to keep the footprint minimal
const metricsToPrune = [
	'nodejs_active_handles',
	'nodejs_active_handles_total',
	'nodejs_active_requests',
	'nodejs_active_requests_total',
	'nodejs_heap_space_size_total_bytes',
	'nodejs_heap_space_size_used_bytes',
	'nodejs_heap_space_size_available_bytes',
	'nodejs_heap_space_size_bytes_total',
	'nodejs_heap_space_size_bytes_used',
	'nodejs_heap_space_size_bytes_available',
	'nodejs_heap_space_size_bytes_required',
	'nodejs_eventloop_lag_seconds',
	'nodejs_eventloop_lag_min_seconds',
	'nodejs_eventloop_lag_max_seconds',
	'nodejs_eventloop_lag_mean_seconds',
	'nodejs_eventloop_lag_stddev_seconds',
	'nodejs_eventloop_lag_p50_seconds',
	'nodejs_eventloop_lag_p90_seconds',
	'nodejs_eventloop_lag_p99_seconds',
	'process_virtual_memory_bytes',
	'process_virtual_memory_max_bytes',
	'process_heap_bytes',
	'process_start_time_seconds',
	'process_open_fds',
	'process_max_fds'
];

for (const metric of metricsToPrune) {
	register.removeSingleMetric(metric);
}

export const jobsTotal = new Counter({
	name: 'when_jobs_total',
	help: 'Total number of background jobs processed.',
	labelNames: ['job_name', 'status'],
	registers: [register]
});

export const jobDuration = new Histogram({
	name: 'when_job_duration_seconds',
	help: 'Execution duration of background jobs.',
	labelNames: ['job_name'],
	registers: [register]
});

export const jobsActive = new Gauge({
	name: 'when_jobs_active',
	help: 'Number of background jobs currently running.',
	labelNames: ['job_name'],
	registers: [register]
});

export const emailsTotal = new Counter({
	name: 'when_emails_total',
	help: 'Total number of emails sent.',
	labelNames: ['recipient_type', 'status', 'email_kind'],
	registers: [register]
});

export const calendarSyncTotal = new Counter({
	name: 'when_calendar_sync_total',
	help: 'Total number of calendar sync scans triggered.',
	labelNames: ['status'],
	registers: [register]
});

export const calendarSyncDuration = new Histogram({
	name: 'when_calendar_sync_duration_seconds',
	help: 'Duration of calendar sync scan loops.',
	labelNames: ['provider_type'],
	registers: [register]
});

export const calendarRefreshTotal = new Counter({
	name: 'when_calendar_refresh_total',
	help: 'Total number of calendar refreshes.',
	labelNames: ['calendar_id', 'provider_type', 'status'],
	registers: [register]
});

type WorkflowHandlerArgs<I> = Omit<
	Parameters<Parameters<OpenWorkflow['implementWorkflow']>[1]>[0],
	'input'
> & { input: I };

export function implementObservedWorkflow<I, R>(
	spec: WorkflowSpec<I, R>,
	handler: (args: WorkflowHandlerArgs<I>) => Promise<R> | R
): void {
	getOpenWorkflow().implementWorkflow(spec, async (args) => {
		jobsActive.inc({ job_name: spec.name });
		const timer = jobDuration.startTimer({ job_name: spec.name });
		try {
			const result = await handler(args as unknown as WorkflowHandlerArgs<I>);
			jobsTotal.inc({ job_name: spec.name, status: 'success' });
			return result;
		} catch (err) {
			jobsTotal.inc({ job_name: spec.name, status: 'failure' });
			throw err;
		} finally {
			jobsActive.dec({ job_name: spec.name });
			timer();
		}
	});
}
