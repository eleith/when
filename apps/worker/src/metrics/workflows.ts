import { Gauge } from '@prometheus-io/client';
import type { WorkflowSpec } from '@when/jobs';
import type { Workflow } from 'openworkflow';
import { register, jobsTotal, jobDuration, jobsActive } from './registry.js';

const activeExecutions = new Map<string, Set<{ started: bigint }>>();

new Gauge({
	name: 'when_job_oldest_active_seconds',
	help: 'Age of the oldest currently executing handler by job name; zero when idle, excluding parked workflows.',
	labelNames: ['job_name'],
	registers: [register],
	collect() {
		const now = process.hrtime.bigint();
		for (const [job_name, executions] of activeExecutions) {
			let oldest = now;
			for (const execution of executions) {
				if (execution.started < oldest) oldest = execution.started;
			}
			this.set({ job_name }, Number(now - oldest) / 1e9);
		}
	}
});

export function observeWorkflow<I, R>(
	spec: WorkflowSpec<I, R>,
	handler: Workflow<I, R, I>['fn']
): Workflow<I, R, I>['fn'] {
	const executions = activeExecutions.get(spec.name) ?? new Set<{ started: bigint }>();
	activeExecutions.set(spec.name, executions);
	jobsActive.inc({ job_name: spec.name }, 0);
	return async (args) => {
		const execution = { started: process.hrtime.bigint() };
		executions.add(execution);
		jobsActive.inc({ job_name: spec.name });
		const timer = jobDuration.startTimer({ job_name: spec.name });
		try {
			const result = await handler(args);
			jobsTotal.inc({ job_name: spec.name, status: 'returned' });
			return result;
		} catch (err) {
			jobsTotal.inc({ job_name: spec.name, status: 'escaped' });
			throw err;
		} finally {
			executions.delete(execution);
			jobsActive.dec({ job_name: spec.name });
			timer();
		}
	};
}
