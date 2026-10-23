import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { OpenWorkflow, defineWorkflowSpec } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import * as jobs from '@when/jobs';
import {
	implementObservedWorkflow,
	jobDuration,
	jobsActive,
	jobsTotal,
	register
} from './metrics.js';

test('registry default labels are set correctly', async () => {
	const json = await register.getMetricsAsJSON();
	// Default labels should be attached to registered metrics
	const firstMetric = json.find((m) => m.name === 'process_resident_memory_bytes');
	expect(firstMetric).toBeDefined();
	if (firstMetric) {
		const firstVal = firstMetric.values[0];
		expect(firstVal).toBeDefined();
		if (firstVal) {
			expect(firstVal.labels).toMatchObject({ app: 'when', service: 'worker' });
		}
	}
});

test('low-value default metrics are pruned', async () => {
	const json = await register.getMetricsAsJSON();
	const names = json.map((m) => m.name);

	// High-value metrics we keep
	expect(names).toContain('process_resident_memory_bytes');
	expect(names).toContain('process_cpu_seconds_total');

	// Low-value metrics we prune
	expect(names).not.toContain('nodejs_active_handles');
	expect(names).not.toContain('nodejs_heap_space_size_total_bytes');
	expect(names).not.toContain('process_virtual_memory_bytes');
});

test('custom worker metrics are registered', async () => {
	const json = await register.getMetricsAsJSON();
	const names = json.map((m) => m.name);

	expect(names).toContain('when_jobs_total');
	expect(names).toContain('when_job_duration_seconds');
	expect(names).toContain('when_jobs_active');
	expect(names).toContain('when_emails_total');
	expect(names).toContain('when_calendar_sync_total');
	expect(names).toContain('when_calendar_sync_duration_seconds');
	expect(names).toContain('when_calendar_refresh_total');
});

describe('native workflow handler metrics', () => {
	let backend: BackendSqlite;
	let client: OpenWorkflow;
	let worker: ReturnType<OpenWorkflow['newWorker']> | undefined;

	beforeEach(() => {
		backend = BackendSqlite.connect(':memory:');
		client = new OpenWorkflow({ backend });
		worker = undefined;
		vi.spyOn(jobs, 'getOpenWorkflow').mockReturnValue(client);
	});

	afterEach(async () => {
		try {
			await worker?.stop();
			await backend.stop();
		} finally {
			jobsTotal.reset();
			jobsActive.reset();
			jobDuration.reset();
			vi.restoreAllMocks();
		}
	});

	async function expectHandlerMetrics(
		jobName: string,
		statuses: Partial<Record<'returned' | 'escaped', number>>,
		executions: number
	) {
		const total = await jobsTotal.get();
		const active = await jobsActive.get();
		const duration = await jobDuration.get();
		const counts = Object.fromEntries(
			total.values.map(({ labels, value }) => [labels.status, value])
		);
		expect(counts).toEqual(statuses);
		expect(total.values.every(({ labels }) => labels.job_name === jobName)).toBe(true);
		expect(active.values).toMatchObject([{ labels: { job_name: jobName }, value: 0 }]);
		expect(
			duration.values
				.filter(({ metricName }) => metricName === 'when_job_duration_seconds_count')
				.map(({ labels, value }) => ({ job_name: labels.job_name, value }))
		).toEqual([{ job_name: jobName, value: executions }]);
	}

	test('counts a returned handler after genuine completion with typed input and output', async () => {
		const spec = defineWorkflowSpec<{ value: number }, { doubled: number }>({
			name: 'observed-return'
		});
		implementObservedWorkflow(spec, async ({ input, step }) => {
			const doubled = await step.run({ name: 'double' }, () => input.value * 2);
			return { doubled };
		});
		worker = client.newWorker({ concurrency: 1 });
		const job = await client.runWorkflow(spec, { value: 21 });
		const claimedCount = await worker.tick();
		await worker.stop();

		const run = await backend.getWorkflowRun({ workflowRunId: job.workflowRun.id });
		expect(claimedCount).toBe(1);
		expect(run).toMatchObject({ status: 'completed', output: { doubled: 42 } });
		await expectHandlerMetrics(spec.name, { returned: 1 }, 1);
	});

	test('counts an escaped root error without swallowing it', async () => {
		const spec = defineWorkflowSpec<Record<string, never>, void>({ name: 'observed-throw' });
		const opaqueError = new Error('root handler failed');
		implementObservedWorkflow(spec, () => {
			throw opaqueError;
		});
		worker = client.newWorker({ concurrency: 1 });
		const job = await client.runWorkflow(spec, {});
		const claimedCount = await worker.tick();
		await worker.stop();

		const run = await backend.getWorkflowRun({ workflowRunId: job.workflowRun.id });
		expect(claimedCount).toBe(1);
		expect(run).toMatchObject({ status: 'failed', error: { message: opaqueError.message } });
		await expectHandlerMetrics(spec.name, { escaped: 1 }, 1);
	});

	test('counts child-wait parking as an escape, then a return when the parent resumes', async () => {
		const child = defineWorkflowSpec<Record<string, never>, string>({ name: 'unobserved-child' });
		const parent = defineWorkflowSpec<Record<string, never>, { childResult: string }>({
			name: 'observed-parent'
		});
		client.implementWorkflow(child, () => 'sent');
		implementObservedWorkflow(parent, async ({ step }) => {
			const childResult = await step.runWorkflow(child, {}, { name: 'delivery' });
			return { childResult };
		});
		worker = client.newWorker({ concurrency: 1 });
		const job = await client.runWorkflow(parent, {});
		const parentClaimedCount = await worker.tick();
		await worker.stop();

		const parked = await backend.getWorkflowRun({ workflowRunId: job.workflowRun.id });
		const page = await backend.listWorkflowRuns({ limit: 10 });
		const childRun = page.data.find(({ workflowName }) => workflowName === child.name);
		expect(parentClaimedCount).toBe(1);
		expect(parked).toMatchObject({ status: 'running', workerId: null });
		expect(childRun).toMatchObject({ status: 'pending', workerId: null });
		await expectHandlerMetrics(parent.name, { escaped: 1 }, 1);

		const childClaimedCount = await worker.tick();
		await worker.stop();
		const completedChild = await backend.getWorkflowRun({ workflowRunId: childRun!.id });
		expect(childClaimedCount).toBe(1);
		expect(completedChild).toMatchObject({ status: 'completed' });
		await expectHandlerMetrics(parent.name, { escaped: 1 }, 1);

		const resumedClaimedCount = await worker.tick();
		await worker.stop();
		const completedParent = await backend.getWorkflowRun({ workflowRunId: job.workflowRun.id });
		expect(resumedClaimedCount).toBe(1);
		expect(completedParent).toMatchObject({
			status: 'completed',
			output: { childResult: 'sent' }
		});
		await expectHandlerMetrics(parent.name, { returned: 1, escaped: 1 }, 2);
	});
});
