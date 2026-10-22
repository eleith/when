import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { OpenWorkflow, type Worker } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import {
	generateVideoChat,
	getOpenWorkflow,
	reconcileAppointment,
	type ReconcileAppointmentInput
} from '@when/jobs';
import { getVideoChatAdapter, type VideoChatAdapter } from '@when/video-chat';
import { openDb, parseActionLog, runMigrations } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';
import type { Envelope, RecipientRole } from '../email/recipients.js';
import type { SendResult } from '../email/smtp.js';
import { clearLogoCache } from '../email/logo.js';
import * as status from '../email/status.js';
import { setWorkerContext, type WorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { runReconcileAppointment } from './reconcile-appointment.js';
import { runGenerateVideoChat } from './generate-video-chat.js';
import {
	deliverAppointmentEmail,
	runDeliverAppointmentEmail
} from './deliver-appointment-email.js';

vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return { ...actual, getOpenWorkflow: vi.fn() };
});
vi.mock('@when/video-chat', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/video-chat')>();
	return { ...actual, getVideoChatAdapter: vi.fn() };
});

type ParentStep = Parameters<typeof runReconcileAppointment>[1];
type DeliveryStep = Parameters<typeof runDeliverAppointmentEmail>[1];
const at = '2026-02-01T12:00:00.000Z';
const clock = { now: () => new Date(at) };
const input: ReconcileAppointmentInput = {
	appointmentId: sampleAppointment.id,
	emailKind: 'pending'
};
const roles: RecipientRole[] = ['guest', 'host'];

function openQueue(
	path = ':memory:',
	beforeParentStep?: (name: string) => Promise<void>,
	register?: (client: OpenWorkflow) => void
) {
	const backend = BackendSqlite.connect(path);
	const client = new OpenWorkflow({ backend });
	vi.mocked(getOpenWorkflow).mockReturnValue(client);
	client.implementWorkflow(deliverAppointmentEmail, ({ input, step }) => {
		const adapted: DeliveryStep = {
			run: (config, fn) =>
				step.run(
					{
						...config,
						retryPolicy: { ...config.retryPolicy, initialInterval: '1ms', maximumInterval: '1ms' }
					},
					fn
				)
		};
		return runDeliverAppointmentEmail(input, adapted, clock);
	});
	client.implementWorkflow(reconcileAppointment, ({ input, step }) => {
		const adapted: ParentStep = {
			...step,
			run: (config, fn) =>
				step.run(
					{
						...config,
						retryPolicy: { initialInterval: '1ms', maximumInterval: '1ms' }
					},
					async () => {
						await beforeParentStep?.(config.name);
						return fn();
					}
				),
			runWorkflow: (...args) => step.runWorkflow(...args)
		};
		return runReconcileAppointment(input, adapted, clock);
	});
	register?.(client);
	const worker = client.newWorker({ concurrency: 1 });
	return {
		backend,
		client,
		worker,
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
	return page.data.filter((attempt) => !stepName || attempt.stepName === stepName);
}
async function driveUntil(worker: Worker, assertion: () => Promise<void>) {
	await vi.waitFor(
		async () => {
			await worker.tick();
			await worker.stop();
			await assertion();
		},
		{ timeout: 5000, interval: 5 }
	);
}
async function children(queue: Queue) {
	const workflowRuns = await runs(queue);
	return workflowRuns.filter((run) => run.workflowName === deliverAppointmentEmail.name);
}
async function startParentAndExpectChildren(queue: Queue, count = 2) {
	expect(await queue.worker.tick()).toBe(1);
	await queue.worker.stop();
	expect(await children(queue)).toHaveLength(count);
}
async function finish(queue: Queue, parentId: string, state = 'completed') {
	await driveUntil(queue.worker, async () => {
		expect(await queue.backend.getWorkflowRun({ workflowRunId: parentId })).toMatchObject({
			status: state
		});
	});
}

let db: ReturnType<typeof openDb>;
let config: WhenConfiguration;
let ctx: WorkerContext;
let send: ReturnType<typeof vi.fn<(envelope: Envelope) => Promise<SendResult>>>;
beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
	await db
		.insertInto('appointments')
		.values({ ...sampleAppointment, status: 'pending' })
		.execute();
	config = structuredClone(sampleConfig);
	config.providers = {};
	config.meetings = {
		'30-min': { title: 'Original meeting', booking_calendar: 'unconfigured', schedule: 'standard' }
	} as unknown as WhenConfiguration['meetings'];
	send = vi.fn(async () => ({ ok: true }));
	ctx = { db, config, logger: createLogger(), mailer: { send } };
	setWorkerContext(ctx);
});
afterEach(async () => {
	vi.restoreAllMocks();
	clearLogoCache();
	await db.destroy();
});
async function emailStates() {
	const row = await db.selectFrom('appointments').select('action_log').executeTakeFirst();
	return parseActionLog(row?.action_log ?? null)
		.filter((entry) => entry.action === 'email')
		.map((entry) => entry.payload?.metadata?.state);
}
function failingMailer(failures: Record<RecipientRole, number>) {
	const counts = { guest: 0, host: 0 };
	send.mockImplementation(async (envelope) => {
		const role = envelope.to === config.user.email ? 'host' : 'guest';
		counts[role] += 1;
		return counts[role] <= failures[role]
			? { ok: false, reason: `SMTP ${role} unavailable` }
			: { ok: true };
	});
	return counts;
}

function configureVideo() {
	config.providers = {
		cloud: {
			type: 'nextcloud',
			url: 'https://cloud.example.com',
			username: 'user',
			password: 'secret',
			calendars: {}
		}
	};
	config.meetings['30-min'].video_chat = { provider: 'cloud', attach: { auto: true } };
}

describe('appointment email reconciliation with native children', () => {
	test('retries transient SMTP failures and logs done only after both roles recover', async () => {
		const counts = failingMailer({ guest: 2, host: 2 });
		const queue = openQueue();
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, input);
			await startParentAndExpectChildren(queue);
			await finish(queue, parent.workflowRun.id);
			expect(await parent.result({ timeoutMs: 500 })).toBe('reconciled');
			expect(counts).toEqual({ guest: 3, host: 3 });
			expect(await emailStates()).toEqual(['failed', 'failed', 'failed', 'failed', 'done']);
			expect(
				await db
					.selectFrom('service_status')
					.select(['error', 'via'])
					.where('kind', '=', 'smtp')
					.executeTakeFirstOrThrow()
			).toEqual({ error: null, via: 'send' });
			for (const child of await children(queue)) {
				expect((await attempts(queue, child.id, 'smtp')).map((attempt) => attempt.status)).toEqual([
					'failed',
					'failed',
					'completed'
				]);
			}
			expect(await runs(queue)).toHaveLength(3);
		} finally {
			await queue.close();
		}
	});

	test.each(roles)(
		'%s exhausts five attempts without taking its sibling budget',
		async (failedRole) => {
			const sibling = failedRole === 'guest' ? 'host' : 'guest';
			const counts = failingMailer({ [failedRole]: 5, [sibling]: 4 } as Record<
				RecipientRole,
				number
			>);
			const queue = openQueue();
			try {
				const parent = await queue.client.runWorkflow(reconcileAppointment, input);
				await startParentAndExpectChildren(queue);
				const links = await attempts(queue, parent.workflowRun.id);
				expect(
					links
						.filter((attempt) => attempt.childWorkflowRunId)
						.map((attempt) => attempt.stepName)
						.sort()
				).toEqual(['email:guest', 'email:host']);
				await finish(queue, parent.workflowRun.id, 'failed');
				await expect(parent.result({ timeoutMs: 500 })).rejects.toThrow(
					`SMTP ${failedRole} unavailable`
				);
				expect(counts).toEqual({ guest: 5, host: 5 });
				expect(await emailStates()).toEqual(Array(9).fill('failed'));
				for (const child of await children(queue)) {
					const role = (child.input as { role: RecipientRole }).role;
					expect(child.status).toBe(role === failedRole ? 'failed' : 'completed');
					expect(await attempts(queue, child.id, 'smtp')).toHaveLength(5);
				}
			} finally {
				await queue.close();
			}
		}
	);

	test('both recipients exhaust independent five-attempt policies with no terminal summary', async () => {
		const counts = failingMailer({ guest: 5, host: 5 });
		const queue = openQueue();
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, input);
			await finish(queue, parent.workflowRun.id, 'failed');
			expect(counts).toEqual({ guest: 5, host: 5 });
			expect((await children(queue)).map((child) => child.status)).toEqual(['failed', 'failed']);
			expect(await emailStates()).toEqual(Array(10).fill('failed'));
			expect(
				await db
					.selectFrom('service_status')
					.select('error')
					.where('kind', '=', 'smtp')
					.executeTakeFirstOrThrow()
			).toEqual({ error: expect.stringMatching(/^SMTP (guest|host) unavailable$/) });
		} finally {
			await queue.close();
		}
	});

	test('equal addresses still produce two role-named children', async () => {
		await db.updateTable('appointments').set({ guest_email: config.user.email }).execute();
		const queue = openQueue();
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, input);
			await finish(queue, parent.workflowRun.id);
			expect(send).toHaveBeenCalledTimes(2);
			expect(send.mock.calls.map(([envelope]) => envelope.to)).toEqual([
				config.user.email,
				config.user.email
			]);
			expect(
				(await children(queue)).map((child) => (child.input as { role: RecipientRole }).role).sort()
			).toEqual(['guest', 'host']);
			expect(await emailStates()).toEqual(['done']);
		} finally {
			await queue.close();
		}
	});

	test('a booking without guest email starts only the host child', async () => {
		await db.updateTable('appointments').set({ guest_email: null }).execute();
		const queue = openQueue();
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, input);
			await finish(queue, parent.workflowRun.id);
			expect(send).toHaveBeenCalledTimes(1);
			expect((await children(queue)).map((child) => child.input)).toEqual([
				expect.objectContaining({ role: 'host' })
			]);
			expect(await emailStates()).toEqual(['done']);
		} finally {
			await queue.close();
		}
	});

	test.each(['missing', 'purged', 'no-email'] as const)(
		'%s reconciliation sends nothing and has no email summary',
		async (state) => {
			if (state === 'missing') await db.deleteFrom('appointments').execute();
			if (state === 'purged')
				await db.updateTable('appointments').set({ status: 'purged' }).execute();
			const queue = openQueue();
			try {
				const parent = await queue.client.runWorkflow(
					reconcileAppointment,
					state === 'no-email' ? { appointmentId: input.appointmentId } : input
				);
				await finish(queue, parent.workflowRun.id);
				expect(await parent.result({ timeoutMs: 500 })).toBe('reconciled');
				expect(send).not.toHaveBeenCalled();
				expect(await children(queue)).toEqual([]);
				expect(await emailStates()).toEqual([]);
			} finally {
				await queue.close();
			}
		}
	);

	test.each(['missing', 'purged'] as const)(
		'prepared children skip a now-%s row without SMTP or done',
		async (state) => {
			const queue = openQueue();
			try {
				const parent = await queue.client.runWorkflow(reconcileAppointment, input);
				await startParentAndExpectChildren(queue);
				if (state === 'missing') await db.deleteFrom('appointments').execute();
				else await db.updateTable('appointments').set({ status: 'purged' }).execute();
				await finish(queue, parent.workflowRun.id);
				expect(send).not.toHaveBeenCalled();
				expect((await children(queue)).map((child) => child.output)).toEqual([
					'skipped',
					'skipped'
				]);
				expect(await emailStates()).toEqual([]);
				expect(await db.selectFrom('service_status').selectAll().execute()).toEqual([]);
			} finally {
				await queue.close();
			}
		}
	);

	test('a mixed sent/skipped set has no done summary', async () => {
		send.mockImplementation(async () => {
			await db.updateTable('appointments').set({ status: 'purged' }).execute();
			return { ok: true };
		});
		const queue = openQueue();
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, input);
			await finish(queue, parent.workflowRun.id);
			expect(send).toHaveBeenCalledTimes(1);
			expect((await children(queue)).map((child) => child.output).sort()).toEqual([
				'sent',
				'skipped'
			]);
			expect(await emailStates()).toEqual([]);
		} finally {
			await queue.close();
		}
	});

	test.each(['cleanup-video-chat', 'request-video-chat', 'sync-calendar'])(
		'rechecks live eligibility inside %s after initial preparation',
		async (blockedStep) => {
			config.providers = {
				cloud: {
					type: 'nextcloud',
					url: 'https://cloud.example.com',
					username: 'user',
					password: 'secret',
					calendars: {}
				}
			};
			config.meetings['30-min'].video_chat = { provider: 'cloud', attach: { auto: true } };
			const external = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(JSON.stringify({ ocs: { data: { token: 'created-room' } } }), {
					status: 201,
					headers: { 'content-type': 'application/json' }
				})
			);
			const queue = openQueue(':memory:', async (name) => {
				if (name === blockedStep)
					await db.updateTable('appointments').set({ status: 'purged' }).execute();
			});
			try {
				const cleanupVideoChatUrl =
					blockedStep === 'cleanup-video-chat'
						? 'https://cloud.example.com/call/old-room'
						: undefined;
				const parent = await queue.client.runWorkflow(reconcileAppointment, {
					...input,
					cleanupVideoChatUrl
				});
				await finish(queue, parent.workflowRun.id);
				expect(external).not.toHaveBeenCalled();
				const workflowRuns = await runs(queue);
				expect(workflowRuns.filter((run) => run.workflowName === generateVideoChat.name)).toEqual(
					[]
				);
				expect(send).not.toHaveBeenCalled();
				const row = await db
					.selectFrom('appointments')
					.select('calendar_synced_revision')
					.executeTakeFirstOrThrow();
				expect(row).toEqual({
					calendar_synced_revision: blockedStep === 'request-video-chat' ? 0 : null
				});
				const states = await emailStates();
				expect(states).toEqual([]);
			} finally {
				await queue.close();
			}
		}
	);

	test('prepared envelopes and role names survive row/config/logo changes and a queue restart', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'when-reconcile-'));
		config.user.appearance.app_icon_path = '/public/original-logo.png';
		const external = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(
				new Response('original image', { headers: { 'content-type': 'image/png' } })
			);
		let queue = openQueue(join(directory, 'queue.sqlite'));
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, {
				...input,
				emailKind: 'confirmed'
			});
			await startParentAndExpectChildren(queue);
			const savedChildren = await children(queue);
			const prepared = savedChildren.map(
				(child) => child.input as unknown as { role: RecipientRole; envelope: Envelope }
			);
			expect(prepared.map((item) => item.role).sort()).toEqual(['guest', 'host']);
			expect(prepared.find((item) => item.role === 'guest')?.envelope.attachments).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ content: expect.stringContaining('BEGIN:VCALENDAR') })
				])
			);
			expect(
				prepared.every((item) =>
					item.envelope.attachments?.some(
						(attachment) => attachment.content === Buffer.from('original image').toString('base64')
					)
				)
			).toBe(true);
			await queue.close();
			await db
				.updateTable('appointments')
				.set({
					guest_email: 'changed@example.com',
					guest_name: 'Changed guest',
					start_time: '2026-03-02T15:00:00Z',
					cancel_token: 'changed-token',
					video_chat: 'https://changed.example.com/call'
				})
				.execute();
			config.user.email = 'new-owner@example.com';
			config.user.name = 'Changed host';
			config.user.appearance.app_icon_path = '/public/changed-logo.png';
			config.meetings['30-min'].title = 'Changed meeting';
			external.mockResolvedValue(
				new Response('changed image', { headers: { 'content-type': 'image/png' } })
			);
			queue = openQueue(join(directory, 'queue.sqlite'));
			await finish(queue, parent.workflowRun.id);
			expect(send.mock.calls.map(([envelope]) => envelope)).toEqual(
				expect.arrayContaining(prepared.map((item) => item.envelope))
			);
			expect(send).toHaveBeenCalledTimes(2);
			expect((await children(queue)).map((child) => child.id).sort()).toEqual(
				savedChildren.map((child) => child.id).sort()
			);
			expect(external).toHaveBeenCalledTimes(1);
			expect(await attempts(queue, parent.workflowRun.id, 'prepare-emails')).toHaveLength(1);
			expect(await emailStates()).toEqual(['done']);
		} finally {
			try {
				await queue.close();
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}
	});

	test.each(['generate', 'saved-link'] as const)(
		'observes the current %s choice before enqueue, not the initial preparation',
		async (choice) => {
			const directory = await mkdtemp(join(tmpdir(), 'when-video-choice-'));
			configureVideo();
			config.meetings['30-min'].video_chat!.attach = { auto: false };
			await db
				.updateTable('appointments')
				.set({
					video_chat_request: choice === 'generate' ? null : 'generate',
					video_chat: choice === 'generate' ? 'https://cloud.example.com/call/original' : null
				})
				.execute();
			let queue = openQueue(join(directory, 'queue.sqlite'), async (name) => {
				if (name === 'sync-calendar') throw new Error('local calendar callback interrupted');
			});
			try {
				const parent = await queue.client.runWorkflow(reconcileAppointment, input);
				await queue.worker.tick();
				await queue.worker.stop();
				const before = await attempts(queue, parent.workflowRun.id, 'request-video-chat');
				expect(before).toEqual([]);
				await queue.close();
				await db
					.updateTable('appointments')
					.set({
						video_chat_request: choice === 'generate' ? 'generate' : null,
						video_chat: choice === 'generate' ? null : 'https://cloud.example.com/call/current'
					})
					.execute();
				queue = openQueue(join(directory, 'queue.sqlite'));
				await finish(queue, parent.workflowRun.id);
				const workflowRuns = await runs(queue);
				const generators = workflowRuns.filter(
					(run) => run.workflowName === generateVideoChat.name
				);
				expect(generators).toHaveLength(choice === 'generate' ? 1 : 0);
				const envelopes = send.mock.calls.map(([envelope]) => envelope.text);
				for (const text of envelopes) {
					if (choice === 'saved-link')
						expect(text).toContain('https://cloud.example.com/call/current');
					else expect(text).not.toContain('https://cloud.example.com/call/original');
				}
				const preparation = await attempts(queue, parent.workflowRun.id, 'prepare-reconciliation');
				expect(preparation).toHaveLength(1);
				expect(send).toHaveBeenCalledTimes(2);
				const states = await emailStates();
				expect(states).toEqual(['done']);
			} finally {
				try {
					await queue.close();
				} finally {
					await rm(directory, { recursive: true, force: true });
				}
			}
		}
	);

	test('the native enqueue checkpoint survives restart without waiting for generation or changing saved mail', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'when-video-enqueue-'));
		configureVideo();
		let queue = openQueue(join(directory, 'queue.sqlite'));
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, input);
			await startParentAndExpectChildren(queue);
			const workflowRuns = await runs(queue);
			const [generator] = workflowRuns.filter((run) => run.workflowName === generateVideoChat.name);
			expect(generator).toMatchObject({
				status: 'pending',
				input: { appointmentId: input.appointmentId }
			});
			const savedEnqueue = await attempts(queue, parent.workflowRun.id, 'request-video-chat');
			expect(savedEnqueue).toHaveLength(1);
			expect(savedEnqueue[0]).toMatchObject({ status: 'completed', childWorkflowRunId: null });
			const savedChildren = await children(queue);
			const prepared = savedChildren.map(
				(child) => (child.input as unknown as { envelope: Envelope }).envelope
			);
			await queue.close();
			await db
				.updateTable('appointments')
				.set({
					video_chat: 'https://cloud.example.com/call/later',
					video_chat_request: 'suppress'
				})
				.execute();
			queue = openQueue(join(directory, 'queue.sqlite'));
			await finish(queue, parent.workflowRun.id);
			const replayedEnqueue = await attempts(queue, parent.workflowRun.id, 'request-video-chat');
			expect(replayedEnqueue).toEqual(savedEnqueue);
			const replayedRuns = await runs(queue);
			expect(
				replayedRuns
					.filter((run) => run.workflowName === generateVideoChat.name)
					.map((run) => run.id)
			).toEqual([generator.id]);
			expect(send.mock.calls.map(([envelope]) => envelope)).toEqual(
				expect.arrayContaining(prepared)
			);
			expect(send).toHaveBeenCalledTimes(2);
			expect(JSON.stringify(prepared)).not.toContain('/call/later');
			const states = await emailStates();
			expect(states).toEqual(['done']);
		} finally {
			try {
				await queue.close();
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}
	});

	test('native pending-read exhaustion fails only generation, not booking mail or either role child', async () => {
		configureVideo();
		const adapter: VideoChatAdapter = {
			read: vi
				.fn<VideoChatAdapter['read']>()
				.mockResolvedValueOnce({ ok: true, status: 'absent' })
				.mockResolvedValue({ ok: false, reason: 'conference still unavailable' }),
			request: vi
				.fn<VideoChatAdapter['request']>()
				.mockResolvedValue({ ok: true, status: 'pending' }),
			removeLink: vi.fn<VideoChatAdapter['removeLink']>().mockResolvedValue({ ok: true })
		};
		vi.mocked(getVideoChatAdapter).mockReturnValue(adapter);
		const queue = openQueue(':memory:', undefined, (client) => {
			client.implementWorkflow(generateVideoChat, ({ input, step }) =>
				runGenerateVideoChat(
					input,
					{
						run: (config, fn) =>
							step.run(
								{
									...config,
									retryPolicy: {
										...config.retryPolicy,
										initialInterval: '1ms',
										maximumInterval: '1ms'
									}
								},
								fn
							)
					},
					clock
				)
			);
		});
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, input);
			await startParentAndExpectChildren(queue);
			await driveUntil(queue.worker, async () => {
				const parkedRuns = await runs(queue);
				const [parkedGenerator] = parkedRuns.filter(
					(run) => run.workflowName === generateVideoChat.name
				);
				expect(parkedGenerator).toMatchObject({ status: 'pending', workerId: null });
				const firstRead = await attempts(queue, parkedGenerator.id, 'read-pending-video-chat');
				expect(firstRead.map((attempt) => attempt.status)).toEqual(['failed']);
			});
			await finish(queue, parent.workflowRun.id);
			expect(send).toHaveBeenCalledTimes(2);
			const deliveryRuns = await children(queue);
			expect(deliveryRuns.map((child) => child.output)).toEqual(['sent', 'sent']);
			for (const [envelope] of send.mock.calls) expect(envelope.text).not.toContain('Video link');
			const workflowRuns = await runs(queue);
			const [generator] = workflowRuns.filter((run) => run.workflowName === generateVideoChat.name);
			await finish(queue, generator.id, 'failed');
			const reads = await attempts(queue, generator.id, 'read-pending-video-chat');
			expect(reads.map((attempt) => attempt.status)).toEqual(Array(10).fill('failed'));
			expect(adapter.request).toHaveBeenCalledTimes(1);
			expect(adapter.read).toHaveBeenCalledTimes(11);
			const parentState = await queue.backend.getWorkflowRun({
				workflowRunId: parent.workflowRun.id
			});
			expect(parentState).toMatchObject({ status: 'completed', output: 'reconciled' });
			const row = await db
				.selectFrom('appointments')
				.select(['video_chat', 'ics_sequence', 'calendar_revision'])
				.executeTakeFirstOrThrow();
			expect(row).toEqual({ video_chat: null, ics_sequence: 0, calendar_revision: 0 });
			const states = await emailStates();
			expect(states).toEqual(['done']);
		} finally {
			await queue.close();
		}
	});

	test('a native SMTP retry rechecks eligibility after a queue restart', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'when-email-eligibility-'));
		send.mockResolvedValue({ ok: false, reason: 'temporary SMTP failure' });
		let queue = openQueue(join(directory, 'queue.sqlite'));
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, input);
			await startParentAndExpectChildren(queue);
			expect(await queue.worker.tick()).toBe(1);
			await queue.worker.stop();
			expect(send).toHaveBeenCalledTimes(1);
			expect(await emailStates()).toEqual(['failed']);
			const failedChild = (await children(queue)).find(
				(child) => child.status === 'pending' && child.error !== null
			);
			expect(failedChild).toBeDefined();
			await queue.close();
			await db.updateTable('appointments').set({ status: 'purged' }).execute();
			queue = openQueue(join(directory, 'queue.sqlite'));
			await finish(queue, parent.workflowRun.id);
			expect(send).toHaveBeenCalledTimes(1);
			expect((await children(queue)).map((child) => child.output)).toEqual(['skipped', 'skipped']);
			expect(await emailStates()).toEqual(['failed']);
			expect(
				(await attempts(queue, failedChild!.id, 'smtp')).map((attempt) => attempt.status)
			).toEqual(['failed', 'completed']);
		} finally {
			try {
				await queue.close();
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}
	});

	test('the final done callback checks eligibility even when both deliveries sent', async () => {
		const queue = openQueue(':memory:', async (name) => {
			if (name === 'log:result')
				await db.updateTable('appointments').set({ status: 'purged' }).execute();
		});
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, input);
			await finish(queue, parent.workflowRun.id);
			expect(send).toHaveBeenCalledTimes(2);
			expect((await children(queue)).map((child) => child.output)).toEqual(['sent', 'sent']);
			expect(await emailStates()).toEqual([]);
		} finally {
			await queue.close();
		}
	});

	test('saved SMTP success survives a status failure and restart without resending', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'when-email-status-'));
		await db.updateTable('appointments').set({ guest_email: null }).execute();
		const bookkeeping = vi
			.spyOn(status, 'recordSendOutcome')
			.mockRejectedValueOnce(new Error('local status failure'));
		let queue = openQueue(join(directory, 'queue.sqlite'));
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, input);
			await startParentAndExpectChildren(queue, 1);
			await driveUntil(queue.worker, async () => {
				const [child] = await children(queue);
				expect(child).toMatchObject({ status: 'pending', workerId: null });
				expect(
					(await attempts(queue, child.id, 'smtp:status')).map((attempt) => attempt.status)
				).toEqual(['failed']);
			});
			const [child] = await children(queue);
			const savedSmtp = await attempts(queue, child.id, 'smtp');
			expect(savedSmtp).toHaveLength(1);
			expect(savedSmtp[0].status).toBe('completed');
			expect(await emailStates()).toEqual([]);
			await queue.close();
			bookkeeping.mockRestore();
			queue = openQueue(join(directory, 'queue.sqlite'));
			await finish(queue, parent.workflowRun.id);
			expect(send).toHaveBeenCalledTimes(1);
			expect(await attempts(queue, child.id, 'smtp')).toEqual(savedSmtp);
			expect(
				(await attempts(queue, child.id, 'smtp:status')).map((attempt) => attempt.status)
			).toEqual(['failed', 'completed']);
			expect(await emailStates()).toEqual(['done']);
		} finally {
			try {
				await queue.close();
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}
	});
});
