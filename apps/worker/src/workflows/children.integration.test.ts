import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenWorkflow, defineWorkflowSpec, type RetryPolicy } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import { reconcileAppointment } from '@when/jobs';
import { describe, expect, test, vi } from 'vitest';
import { tickAndSettle } from './__fixtures__/tick-and-settle.js';

type Role = 'guest' | 'host';
const roles: Role[] = ['guest', 'host'];

// Keep the real budgets; only shorten native delays, not the number of attempts.
const deliveryRetry: RetryPolicy = {
	maximumAttempts: 5,
	initialInterval: '10ms',
	backoffCoefficient: 2,
	maximumInterval: '20ms'
};

interface Delivery {
	send(role: Role): Promise<void>;
	status(role: Role): Promise<void>;
	parkRole?: Role;
	waitTimeout?: number;
}

function openQueue(path: string, delivery: Delivery) {
	const backend = BackendSqlite.connect(path);
	const client = new OpenWorkflow({ backend });
	const child = defineWorkflowSpec<{ role: Role }, 'sent'>({
		name: 'delivery-child',
		retryPolicy: { maximumAttempts: 3 }
	});
	const parent = defineWorkflowSpec<Record<string, never>, 'sent'[]>({
		name: 'delivery-parent',
		retryPolicy: {
			...reconcileAppointment.retryPolicy,
			initialInterval: '10ms',
			maximumInterval: '20ms'
		}
	});
	client.implementWorkflow(child, async ({ input, step }) => {
		if (input.role === delivery.parkRole) {
			await step.waitForSignal({ name: 'release', signal: `release:${input.role}` });
		}
		await step.run({ name: 'smtp', retryPolicy: deliveryRetry }, async () => {
			await delivery.send(input.role);
			return 'sent';
		});
		await step.run({ name: 'status', retryPolicy: deliveryRetry }, async () => {
			await delivery.status(input.role);
			return 'recorded';
		});
		return 'sent';
	});
	client.implementWorkflow(parent, ({ step }) =>
		Promise.all(
			roles.map((role) =>
				step.runWorkflow(child, { role }, { name: role, timeout: delivery.waitTimeout })
			)
		)
	);
	const worker = client.newWorker({ concurrency: 1 });
	return {
		backend,
		client,
		worker,
		parent,
		async close() {
			try {
				await worker.stop();
			} finally {
				await backend.stop();
			}
		}
	};
}

type Queue = ReturnType<typeof openQueue>;

async function runs(queue: Queue) {
	const page = await queue.backend.listWorkflowRuns({ limit: 100 });
	expect(page.pagination.next).toBeNull();
	return page.data;
}

async function attempts(queue: Queue, workflowRunId: string, stepName?: string) {
	const page = await queue.backend.listStepAttempts({ workflowRunId, limit: 100 });
	expect(page.pagination.next).toBeNull();
	return page.data.filter((attempt) => stepName === undefined || attempt.stepName === stepName);
}

async function readRun(queue: Queue, workflowRunId: string) {
	const run = await queue.backend.getWorkflowRun({ workflowRunId });
	expect(run).not.toBeNull();
	return run!;
}

async function driveUntil(queue: Queue, assertion: () => Promise<void>) {
	await vi.waitFor(
		async () => {
			await tickAndSettle(queue);
			await assertion();
		},
		{ timeout: 3000, interval: 5 }
	);
}

// No background poll loop: each tick admits work only when the assertion needs it.
async function admitted(queue: Queue, parentId: string) {
	const ticked = await tickAndSettle(queue);
	expect(ticked).toBe(1);
	await vi.waitFor(
		async () => {
			const parent = await readRun(queue, parentId);
			expect(parent).toMatchObject({ status: 'running', workerId: null });
			const children = (await runs(queue)).filter((run) => run.id !== parentId);
			expect(children).toHaveLength(2);
			expect(children.map((run) => run.input)).toEqual(
				expect.arrayContaining(roles.map((role) => ({ role })))
			);
			const links = await attempts(queue, parentId);
			expect(links).toHaveLength(2);
			expect(links.map((attempt) => attempt.childWorkflowRunId).sort()).toEqual(
				children.map((run) => run.id).sort()
			);
		},
		{ timeout: 3000, interval: 5 }
	);
}

async function childFor(queue: Queue, role: Role) {
	const children = (await runs(queue)).filter((run) => run.workflowName === 'delivery-child');
	expect(children).toHaveLength(2);
	const child = children.find((run) => JSON.stringify(run.input) === JSON.stringify({ role }));
	expect(child).toBeDefined();
	return child!;
}

function fakeDelivery(
	failures: Record<Role, number>,
	statusFailures: Partial<Record<Role, number>> = {}
) {
	const sends = { guest: 0, host: 0 };
	const statuses = { guest: 0, host: 0 };
	return {
		sends,
		statuses,
		send: vi.fn(async (role: Role) => {
			sends[role] += 1;
			if (sends[role] <= failures[role]) throw new Error(`SMTP ${role} unavailable`);
		}),
		status: vi.fn(async (role: Role) => {
			statuses[role] += 1;
			if (statuses[role] <= (statusFailures[role] ?? 0)) {
				throw new Error(`status ${role} unavailable`);
			}
		})
	};
}

describe('native parallel child workflows at concurrency one', () => {
	test.each(roles)(
		'%s exhaustion leaves its sibling independent and eventually fails the parent',
		async (failedRole) => {
			const siblingRole = failedRole === 'guest' ? 'host' : 'guest';
			const delivery = fakeDelivery({ [failedRole]: 5, [siblingRole]: 4 } as Record<Role, number>);
			const queue = openQueue(':memory:', { ...delivery, parkRole: siblingRole });
			try {
				const parent = await queue.client.runWorkflow(queue.parent, {});
				await admitted(queue, parent.workflowRun.id);
				await driveUntil(queue, async () => {
					expect(await childFor(queue, failedRole)).toMatchObject({
						status: 'failed',
						output: null,
						error: { message: `SMTP ${failedRole} unavailable` }
					});
					expect(await childFor(queue, siblingRole)).toMatchObject({
						status: 'running',
						workerId: null
					});
				});
				const failed = await childFor(queue, failedRole);
				expect(failed.status).toBe('failed');
				expect(await attempts(queue, failed.id, 'smtp')).toHaveLength(5);
				expect(
					(await attempts(queue, failed.id, 'smtp')).every((attempt) => attempt.status === 'failed')
				).toBe(true);
				expect(delivery.sends[failedRole]).toBe(5);
				expect(delivery.sends[siblingRole]).toBe(0);
				// Failure propagation can wait for the sibling; it must not cancel it.
				expect((await readRun(queue, parent.workflowRun.id)).status).not.toBe('completed');
				const sibling = await childFor(queue, siblingRole);
				expect(sibling).toMatchObject({ status: 'running', workerId: null });
				expect(await attempts(queue, sibling.id, 'release')).toHaveLength(1);
				expect(await queue.client.sendSignal({ signal: `release:${siblingRole}` })).toEqual({
					workflowRunIds: [sibling.id]
				});
				await driveUntil(queue, async () => {
					expect(await readRun(queue, sibling.id)).toMatchObject({
						status: 'completed',
						output: 'sent'
					});
					expect(await readRun(queue, parent.workflowRun.id)).toMatchObject({
						status: 'failed',
						output: null,
						error: { message: `SMTP ${failedRole} unavailable` }
					});
				});
				await expect(parent.result({ timeoutMs: 500 })).rejects.toThrow(
					`SMTP ${failedRole} unavailable`
				);
				expect(delivery.sends).toEqual({ guest: 5, host: 5 });
				expect(await attempts(queue, sibling.id, 'smtp')).toHaveLength(5);
				expect((await readRun(queue, parent.workflowRun.id)).status).toBe('failed');
				expect(await runs(queue)).toHaveLength(3);
			} finally {
				await queue.close();
			}
		}
	);

	test('reopens a file-backed queue during child retry without duplicating children or saved SMTP success', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'when-children-'));
		const delivery = fakeDelivery({ guest: 0, host: 1 }, { host: 2 });
		let queue = openQueue(join(directory, 'queue.sqlite'), delivery);
		try {
			const parent = await queue.client.runWorkflow(queue.parent, {});
			const parentId = parent.workflowRun.id;
			await admitted(queue, parentId);
			await driveUntil(queue, async () => {
				const host = await childFor(queue, 'host');
				expect(host).toMatchObject({ status: 'pending', workerId: null });
				expect(await attempts(queue, host.id, 'smtp')).toHaveLength(1);
			});
			const childIds = (await runs(queue)).map((run) => run.id).sort();
			await queue.close();
			queue = openQueue(join(directory, 'queue.sqlite'), delivery);
			await driveUntil(queue, async () => {
				const host = await childFor(queue, 'host');
				expect(host).toMatchObject({ status: 'pending', workerId: null });
				expect(await attempts(queue, host.id, 'status')).toHaveLength(1);
				expect(await attempts(queue, host.id, 'smtp')).toHaveLength(2);
				expect((await childFor(queue, 'guest')).status).toBe('completed');
			});
			const host = await childFor(queue, 'host');
			const savedSmtp = await attempts(queue, host.id, 'smtp');
			const savedGuest = await attempts(queue, (await childFor(queue, 'guest')).id);
			await queue.close();
			queue = openQueue(join(directory, 'queue.sqlite'), delivery);
			await driveUntil(queue, async () => {
				expect(await readRun(queue, parentId)).toMatchObject({
					status: 'completed',
					output: ['sent', 'sent']
				});
			});
			expect((await runs(queue)).map((run) => run.id).sort()).toEqual(childIds);
			expect(await attempts(queue, parentId)).toHaveLength(2);
			expect(await attempts(queue, host.id, 'smtp')).toEqual(savedSmtp);
			expect(await attempts(queue, (await childFor(queue, 'guest')).id)).toEqual(savedGuest);
			expect((await attempts(queue, host.id, 'status')).map((attempt) => attempt.status)).toEqual([
				'failed',
				'failed',
				'completed'
			]);
			expect(delivery.sends).toEqual({ guest: 1, host: 2 });
			expect(delivery.statuses).toEqual({ guest: 1, host: 3 });
		} finally {
			try {
				await queue.close();
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}
	});

	test.each(['cancel', 'timeout'] as const)(
		'parent %s leaves its already-started child alive',
		async (mode) => {
			const delivery = fakeDelivery({ guest: 0, host: 0 });
			const queue = openQueue(':memory:', {
				...delivery,
				parkRole: 'host',
				waitTimeout: mode === 'timeout' ? 50 : undefined
			});
			try {
				const parent = await queue.client.runWorkflow(queue.parent, {});
				await admitted(queue, parent.workflowRun.id);
				await driveUntil(queue, async () => {
					const host = await childFor(queue, 'host');
					expect(host).toMatchObject({ status: 'running', workerId: null });
					expect(await attempts(queue, host.id, 'release')).toHaveLength(1);
				});
				if (mode === 'cancel') await parent.cancel();
				await driveUntil(queue, async () => {
					expect((await readRun(queue, parent.workflowRun.id)).status).toBe(
						mode === 'cancel' ? 'canceled' : 'failed'
					);
				});
				await expect(parent.result({ timeoutMs: 500 })).rejects.toThrow(
					mode === 'cancel' ? /cancel/i : /Timed out waiting for child workflow/
				);
				const host = await childFor(queue, 'host');
				expect(host.status).toBe('running');
				await queue.client.sendSignal({ signal: 'release:host' });
				await driveUntil(queue, async () => {
					expect(await readRun(queue, host.id)).toMatchObject({
						status: 'completed',
						output: 'sent'
					});
				});
				expect(delivery.sends.host).toBe(1);
				expect(await runs(queue)).toHaveLength(3);
			} finally {
				await queue.close();
			}
		}
	);
});
