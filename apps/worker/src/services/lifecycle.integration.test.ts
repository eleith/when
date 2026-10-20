import { expect, test } from 'vitest';
import { OpenWorkflow, defineWorkflowSpec } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import { openDb, runMigrations } from '@when/db';
import { sampleAppointment } from '../email/__fixtures__/appointment.js';
import { createShutdown } from './lifecycle.js';

test('shutdown waits for an active native step before closing either database', async () => {
	const db = openDb(':memory:');
	await runMigrations(db);
	await db.insertInto('appointments').values(sampleAppointment).execute();
	const backend = BackendSqlite.connect(':memory:');
	const client = new OpenWorkflow({ backend });
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const events: string[] = [];
	const spec = defineWorkflowSpec<Record<string, never>, 'done'>({ name: 'active-maintenance' });
	client.implementWorkflow(spec, async ({ step }) => {
		await step.run({ name: 'active-pass' }, async () => {
			started.resolve();
			await release.promise;
			await db.updateTable('appointments').set({ note: 'finished' }).execute();
			events.push('pass:finished');
		});
		return 'done';
	});
	const worker = client.newWorker({ concurrency: 1 });
	const job = await client.runWorkflow(spec, {});
	let status: string | undefined;
	let note: string | null | undefined;
	const shutdown = createShutdown({
		worker,
		closeQueue: async () => {
			status = (await backend.getWorkflowRun({ workflowRunId: job.workflowRun.id }))?.status;
			events.push('queue:close');
			await backend.stop();
		},
		closeDatabase: async () => {
			note = (await db.selectFrom('appointments').select('note').executeTakeFirst())?.note;
			events.push('database:close');
			await db.destroy();
		}
	});
	try {
		const claimedCount = await worker.tick();
		expect(claimedCount).toBe(1);
		await started.promise;
		const stopping = shutdown();
		expect(shutdown()).toBe(stopping);
		expect(events).toEqual([]);
		release.resolve();
		await stopping;
		expect(events).toEqual(['pass:finished', 'queue:close', 'database:close']);
		expect(status).toBe('completed');
		expect(note).toBe('finished');
	} finally {
		release.resolve();
		await shutdown();
	}
});

test('shutdown closes a native queue without waiting for a future retry', async () => {
	const backend = BackendSqlite.connect(':memory:');
	const client = new OpenWorkflow({ backend });
	const spec = defineWorkflowSpec<Record<string, never>, 'done'>({ name: 'parked-retry' });
	let calls = 0;
	client.implementWorkflow(spec, async ({ step }) => {
		await step.run(
			{
				name: 'retrying-pass',
				retryPolicy: { maximumAttempts: 5, initialInterval: '1h', maximumInterval: '1h' }
			},
			() => {
				calls += 1;
				throw new Error('temporary provider failure');
			}
		);
		return 'done';
	});
	const worker = client.newWorker({ concurrency: 1 });
	const job = await client.runWorkflow(spec, {});
	let status: string | undefined;
	let availableAt: Date | null | undefined;
	let databaseClosed = false;
	const shutdown = createShutdown({
		worker,
		closeQueue: async () => {
			const run = await backend.getWorkflowRun({ workflowRunId: job.workflowRun.id });
			status = run?.status;
			availableAt = run?.availableAt;
			await backend.stop();
		},
		closeDatabase: async () => {
			databaseClosed = true;
		}
	});
	try {
		const claimedCount = await worker.tick();
		expect(claimedCount).toBe(1);
		await worker.stop();
		await shutdown();
		expect(status).toBe('pending');
		expect(availableAt?.getTime()).toBeGreaterThan(Date.now());
		expect(calls).toBe(1);
		expect(databaseClosed).toBe(true);
	} finally {
		await shutdown();
	}
});

test('shutdown does not drain pending children of a parked native parent', async () => {
	const backend = BackendSqlite.connect(':memory:');
	const client = new OpenWorkflow({ backend });
	const child = defineWorkflowSpec<Record<string, never>, 'sent'>({ name: 'parked-child' });
	const parent = defineWorkflowSpec<Record<string, never>, 'done'>({ name: 'parked-parent' });
	let childCalls = 0;
	client.implementWorkflow(child, () => {
		childCalls += 1;
		return 'sent';
	});
	client.implementWorkflow(parent, async ({ step }) => {
		await step.runWorkflow(child, {}, { name: 'delivery' });
		return 'done';
	});
	const worker = client.newWorker({ concurrency: 1 });
	await client.runWorkflow(parent, {});
	let states: { workflowName: string; status: string; workerId: string | null }[] = [];
	const shutdown = createShutdown({
		worker,
		closeQueue: async () => {
			const page = await backend.listWorkflowRuns({ limit: 10 });
			states = page.data.map(({ workflowName, status, workerId }) => ({
				workflowName,
				status,
				workerId
			}));
			await backend.stop();
		},
		closeDatabase: async () => {}
	});
	try {
		const claimedCount = await worker.tick();
		expect(claimedCount).toBe(1);
		await worker.stop();
		await shutdown();
		expect(states).toEqual(
			expect.arrayContaining([
				{ workflowName: child.name, status: 'pending', workerId: null },
				{ workflowName: parent.name, status: 'running', workerId: null }
			])
		);
		expect(states).toHaveLength(2);
		expect(childCalls).toBe(0);
	} finally {
		await shutdown();
	}
});
