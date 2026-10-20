import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OpenWorkflow, defineWorkflowSpec } from 'openworkflow';
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
			vi.restoreAllMocks();
			vi.useRealTimers();
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

	test.each([
		['completed', 10],
		['completed', 11],
		['failed', 10],
		['failed', 11],
		['canceled', 10],
		['canceled', 11]
	] as const)(
		'result() observes %s when its read crosses the %ims timeout boundary',
		async (status, elapsed) => {
			vi.useFakeTimers({ toFake: ['Date'] });
			const start = new Date('2026-02-01T00:00:00.000Z');
			vi.setSystemTime(start);
			const workflow = client.defineWorkflow(
				{ name: 'boundary-probe', retryPolicy: { maximumAttempts: 1 } },
				() => {
					if (status === 'failed') throw new Error('synthetic boundary failure');
					return 'finished';
				}
			);
			const handle = await workflow.run({});
			if (status === 'canceled') {
				await handle.cancel();
			} else {
				worker = client.newWorker({ concurrency: 1 });
				expect(await worker.tick()).toBe(1);
				await worker.stop();
			}
			expect(getWorkflowRun(raw, handle.workflowRun.id)!.status).toBe(status);
			// Model a backend read completing at/after the deadline. Exercise the actual
			// returned handle, not a local reproduction of its polling algorithm.
			const read = backend.getWorkflowRun.bind(backend);
			vi.spyOn(backend, 'getWorkflowRun').mockImplementation(async (params) => {
				const run = await read(params);
				vi.setSystemTime(start.getTime() + elapsed);
				return run;
			});
			if (status === 'completed') {
				await expect(handle.result({ timeoutMs: 10 })).resolves.toBe('finished');
			} else {
				await expect(handle.result({ timeoutMs: 10 })).rejects.toThrow(
					status === 'failed' ? /synthetic boundary failure/ : /canceled/
				);
			}
		}
	);

	test('result() still times out if a read crosses the boundary with a nonterminal run', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const start = new Date('2026-02-01T00:00:00.000Z');
		vi.setSystemTime(start);
		const handle = await client.runWorkflow(
			defineWorkflowSpec({ name: 'unregistered-producer' }),
			{}
		);
		const read = backend.getWorkflowRun.bind(backend);
		vi.spyOn(backend, 'getWorkflowRun').mockImplementation(async (params) => {
			const run = await read(params);
			vi.setSystemTime(start.getTime() + 11);
			return run;
		});
		await expect(handle.result({ timeoutMs: 10 })).rejects.toThrow(/Timed out/);
		expect(getWorkflowRun(raw, handle.workflowRun.id)!.status).toBe('pending');
	});
});
