import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OpenWorkflow } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getWorkflowRun, getStepAttempts } from './openworkflow.js';
import { reconcileAppointment } from './specs.js';

describe('client singleton', () => {
	let api: typeof import('./index.js');

	beforeEach(async () => {
		vi.resetModules();
		api = await import('./index.js');
	});

	afterEach(async () => {
		await api.closeOpenWorkflow();
	});

	test('get throws before initialization; closing before init does not poison later init', async () => {
		expect(() => api.getOpenWorkflow()).toThrow(/has not been initialized/);
		await api.closeOpenWorkflow();
		const client = api.initOpenWorkflow({ dbPath: ':memory:' });
		expect(api.getOpenWorkflow()).toBe(client);
	});

	test('first initialization wins and a producer can enqueue without worker registration', async () => {
		const client = api.initOpenWorkflow({ dbPath: ':memory:' });
		expect(api.initOpenWorkflow({ dbPath: ':memory:' })).toBe(client);
		expect(api.getOpenWorkflow()).toBe(client);
		const handle = await client.runWorkflow(reconcileAppointment, {
			appointmentId: 'synthetic-appointment',
			emailKind: 'confirmed'
		});
		expect(handle.workflowRun.id).toBeTruthy();
		expect(handle.workflowRun.status).toBe('pending');
	});

	test('public close is shared, idempotent and terminal for init/get and the retained client', async () => {
		const client = api.initOpenWorkflow({ dbPath: ':memory:' });
		const closing = api.closeOpenWorkflow();
		expect(api.closeOpenWorkflow()).toBe(closing);
		expect(() => api.getOpenWorkflow()).toThrow(/has been closed/);
		expect(() => api.initOpenWorkflow({ dbPath: ':memory:' })).toThrow(/has been closed/);
		await closing;
		expect(api.closeOpenWorkflow()).toBe(closing);
		await expect(
			client.runWorkflow(reconcileAppointment, { appointmentId: 'after-close' })
		).rejects.toThrow();
	});
});

describe('real SQLite engine integration', () => {
	let directory: string;
	let raw: DatabaseSync;
	let backend: BackendSqlite;
	let client: OpenWorkflow;
	let worker: ReturnType<OpenWorkflow['newWorker']> | undefined;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), 'when-queue-read-'));
		const path = join(directory, 'queue.sqlite');
		backend = BackendSqlite.connect(path);
		client = new OpenWorkflow({ backend });
		raw = new DatabaseSync(path);
	});

	afterEach(async () => {
		try {
			await worker?.stop();
			await backend.stop();
		} finally {
			worker = undefined;
			raw.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	test('raw readers expose real run and chronological step rows, including missing ids', async () => {
		const workflow = client.defineWorkflow({ name: 'reader-probe' }, async ({ step }) => {
			await step.run({ name: 'first' }, async () => {
				await new Promise((resolve) => setTimeout(resolve, 2));
				return 'saved';
			});
			return step.run({ name: 'second' }, () => 'done');
		});
		const handle = await workflow.run({});
		expect(getWorkflowRun(raw, handle.workflowRun.id)).toMatchObject({ status: 'pending' });
		expect(getStepAttempts(raw, handle.workflowRun.id)).toEqual([]);
		worker = client.newWorker({ concurrency: 1 });
		expect(await worker.tick()).toBe(1);
		await worker.stop();
		const run = getWorkflowRun(raw, handle.workflowRun.id)!;
		expect(run).toMatchObject({
			workflow_name: 'reader-probe',
			status: 'completed',
			input: '{}',
			output: '"done"',
			error: null
		});
		expect(run.finished_at).toEqual(expect.any(String));
		const steps = getStepAttempts(raw, handle.workflowRun.id);
		expect(steps).toEqual(
			['first', 'second'].map((phase) => ({
				phase,
				status: 'completed',
				message: null,
				started_at: expect.any(String),
				finished_at: expect.any(String)
			}))
		);
		expect(steps[0].started_at! <= steps[1].started_at!).toBe(true);
		expect(getWorkflowRun(raw, 'missing')).toBeNull();
		expect(getStepAttempts(raw, 'missing')).toEqual([]);
	});
});
