import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { OpenWorkflow } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import {
	generateVideoChat,
	getOpenWorkflow,
	reconcileAppointment,
	type ReconcileAppointmentInput
} from '@when/jobs';
import { getVideoChatAdapter, type VideoChatAdapter } from '@when/video-chat';
import { openDb, parseActionLog, recordServiceOutcome, runMigrations } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';
import type { Envelope, RecipientRole } from '../email/recipients.js';
import type { SendResult } from '../email/smtp.js';
import { clearLogoCache } from '../email/logo.js';
import * as status from '../email/status.js';
import { setWorkerContext, type WorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { tickAndSettle } from './__fixtures__/tick-and-settle.js';
import { runReconcileAppointment } from './reconcile-appointment.js';
import { notifyAppointment, runNotifyAppointment } from './notify-appointment.js';
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
	register?: (client: OpenWorkflow) => void,
	afterParentStep?: (name: string) => Promise<void>
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
						const result = await fn();
						await afterParentStep?.(config.name);
						return result;
					}
				),
			runWorkflow: (...args) => step.runWorkflow(...args)
		};
		return runReconcileAppointment(input, adapted);
	});
	client.implementWorkflow(notifyAppointment, ({ input, step }) =>
		runNotifyAppointment(
			input,
			{
				run: (settings, fn) =>
					step.run(
						{ ...settings, retryPolicy: { initialInterval: '1ms', maximumInterval: '1ms' } },
						async () => {
							await beforeParentStep?.(settings.name);
							const result = await fn();
							return result;
						}
					),
				runWorkflow: (...args) => step.runWorkflow(...args)
			},
			clock
		)
	);
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
async function driveUntil(queue: Queue, assertion: () => Promise<void>) {
	await vi.waitFor(
		async () => {
			await tickAndSettle(queue);
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
	await driveUntil(queue, async () => {
		const deliveries = await children(queue);
		expect(deliveries).toHaveLength(count);
		expect(deliveries.every((run) => run.status === 'pending')).toBe(true);
	});
}
async function notificationId(queue: Queue) {
	const workflowRuns = await runs(queue);
	const notice = workflowRuns.find((run) => run.workflowName === notifyAppointment.name);
	if (!notice) throw new Error('Missing notification child');
	return notice.id;
}
async function finish(queue: Queue, parentId: string, state = 'completed') {
	await driveUntil(queue, async () => {
		const workflowRun = await queue.backend.getWorkflowRun({ workflowRunId: parentId });
		expect(workflowRun).toMatchObject({
			status: state
		});
	});
}

let db: ReturnType<typeof openDb>;
let config: WhenConfiguration;
let ctx: WorkerContext;
let send: ReturnType<typeof vi.fn<(envelope: Envelope) => Promise<SendResult>>>;
beforeEach(async () => {
	vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network call'));
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
	test.each(['pending', 'confirmed'] as const)(
		'automatic matching %s delegates its full notice purpose without a separate parent notification',
		async (kind) => {
			configureVideo();
			config.meetings['30-min'].video_chat!.attach = { when: [{ field: 'loc', equals: 'Video' }] };
			await db
				.updateTable('appointments')
				.set({
					status: kind,
					guest_answers: JSON.stringify([
						{ name: 'loc', type: 'event_location', label: 'Location', value: 'Video' }
					])
				})
				.execute();
			const queue = openQueue();
			try {
				const parent = await queue.client.runWorkflow(reconcileAppointment, {
					appointmentId: input.appointmentId,
					emailKind: kind
				});
				await tickAndSettle(queue);
				const workflowRuns = await runs(queue);
				const generators = workflowRuns.filter(
					(run) => run.workflowName === generateVideoChat.name
				);
				expect(generators).toHaveLength(1);
				expect(generators[0]).toMatchObject({
					input: { appointmentId: input.appointmentId, notificationKind: kind },
					idempotencyKey: `generate-video-chat:${input.appointmentId}:0:${kind}`
				});
				expect(workflowRuns.filter((run) => run.workflowName === notifyAppointment.name)).toEqual(
					[]
				);
				const current = await queue.backend.getWorkflowRun({
					workflowRunId: parent.workflowRun.id
				});
				expect(current).toMatchObject({ status: 'completed', output: 'reconciled' });
				expect(send).not.toHaveBeenCalled();
			} finally {
				await queue.close();
			}
		}
	);

	test('a lost delegation checkpoint reuses the original purpose/revision key after a link is selected', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'when-original-notice-key-'));
		configureVideo();
		await db.updateTable('appointments').set({ status: 'confirmed' }).execute();
		const originalKey = `generate-video-chat:${input.appointmentId}:0:confirmed`;
		const selectedUrl = 'https://cloud.example.com/call/selected';
		const registerGeneration = (client: OpenWorkflow) => {
			client.implementWorkflow(generateVideoChat, ({ input, step }) =>
				runGenerateVideoChat(input, step, clock)
			);
		};
		let loseCheckpoint = true;
		let queue = openQueue(
			join(directory, 'queue.sqlite'),
			undefined,
			registerGeneration,
			async (name) => {
				if (name === 'delegate-booking-notification' && loseCheckpoint) {
					loseCheckpoint = false;
					throw new Error('delegation effect saved, step checkpoint lost');
				}
			}
		);
		try {
			const firstProducer = vi.spyOn(queue.client, 'runWorkflow');
			const parent = await queue.client.runWorkflow(reconcileAppointment, {
				...input,
				emailKind: 'confirmed'
			});
			await tickAndSettle(queue);
			const preparation = await attempts(queue, parent.workflowRun.id, 'prepare-reconciliation');
			expect(preparation[0]).toMatchObject({
				status: 'completed',
				output: { videoNotificationKind: 'confirmed', calendarRevision: 0 }
			});
			const failedDelegation = await attempts(
				queue,
				parent.workflowRun.id,
				'delegate-booking-notification'
			);
			expect(failedDelegation.map((attempt) => attempt.status)).toEqual(['failed']);
			const initialRuns = await runs(queue);
			const originalGenerator = initialRuns.find(
				(run) => run.workflowName === generateVideoChat.name
			)!;
			expect(originalGenerator).toMatchObject({ status: 'pending', idempotencyKey: originalKey });
			expect(send).not.toHaveBeenCalled();
			const firstEnqueues = firstProducer.mock.calls.filter(
				([spec]) => spec.name === generateVideoChat.name
			);
			await queue.close();

			// Simulate generation's materialization while its producer is parked before replay.
			await db
				.updateTable('appointments')
				.set({ video_chat: selectedUrl, calendar_revision: 1, ics_sequence: 1 })
				.execute();
			queue = openQueue(join(directory, 'queue.sqlite'), undefined, registerGeneration);
			const replayProducer = vi.spyOn(queue.client, 'runWorkflow');
			await driveUntil(queue, async () => {
				const workflowRuns = await runs(queue);
				expect(workflowRuns.every((run) => run.status === 'completed')).toBe(true);
			});
			const replayEnqueues = replayProducer.mock.calls.filter(
				([spec]) => spec.name === generateVideoChat.name
			);
			for (const enqueues of [firstEnqueues, replayEnqueues]) {
				expect(enqueues).toEqual([
					[
						generateVideoChat,
						{ appointmentId: input.appointmentId, notificationKind: 'confirmed' },
						{ idempotencyKey: originalKey }
					]
				]);
			}
			const finalRuns = await runs(queue);
			const generators = finalRuns.filter((run) => run.workflowName === generateVideoChat.name);
			expect(generators.map((run) => run.id)).toEqual([originalGenerator.id]);
			const notices = finalRuns.filter((run) => run.workflowName === notifyAppointment.name);
			expect(notices).toHaveLength(1);
			expect(notices[0]).toMatchObject({
				input: { appointmentId: input.appointmentId, kind: 'confirmed' },
				output: { videoChatUrl: selectedUrl }
			});
			const replayedPreparation = await attempts(
				queue,
				parent.workflowRun.id,
				'prepare-reconciliation'
			);
			expect(replayedPreparation).toEqual(preparation);
			const delegation = await attempts(
				queue,
				parent.workflowRun.id,
				'delegate-booking-notification'
			);
			expect(delegation.map((attempt) => attempt.status)).toEqual(['failed', 'completed']);
			expect(send).toHaveBeenCalledTimes(2);
			for (const [envelope] of send.mock.calls) expect(envelope.text).toContain(selectedUrl);
		} finally {
			try {
				await queue.close();
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}
	});

	test.each(['existing', 'no-config', 'phone', 'nonmatch', 'suppress', 'manual-force'] as const)(
		'%s keeps the full notice under Reconcile → Notify → role',
		async (choice) => {
			configureVideo();
			if (choice === 'existing')
				await db
					.updateTable('appointments')
					.set({ video_chat: 'https://cloud.example.com/call/chosen' })
					.execute();
			if (choice === 'no-config') delete config.meetings['30-min'].video_chat;
			if (choice === 'phone') {
				config.meetings['30-min'].video_chat!.attach = {
					when: [{ field: 'loc', equals: 'Video' }]
				};
				await db
					.updateTable('appointments')
					.set({
						guest_answers: JSON.stringify([
							{ name: 'loc', type: 'event_location', label: 'Location', value: 'Phone' }
						])
					})
					.execute();
			}
			if (choice === 'nonmatch' || choice === 'manual-force')
				config.meetings['30-min'].video_chat!.attach = { auto: false };
			if (choice === 'suppress' || choice === 'manual-force')
				await db
					.updateTable('appointments')
					.set({ video_chat_request: choice === 'suppress' ? 'suppress' : 'generate' })
					.execute();
			const queue = openQueue(':memory:', undefined, (client) => {
				client.implementWorkflow(generateVideoChat, async () => ({ url: null }));
			});
			try {
				const parent = await queue.client.runWorkflow(reconcileAppointment, input);
				await finish(queue, parent.workflowRun.id);
				const workflowRuns = await runs(queue);
				const notices = workflowRuns.filter((run) => run.workflowName === notifyAppointment.name);
				expect(notices).toHaveLength(1);
				expect(notices[0].input).toEqual({ appointmentId: input.appointmentId, kind: 'pending' });
				const links = await attempts(queue, parent.workflowRun.id, 'notify-appointment');
				expect(links[0]).toMatchObject({ childWorkflowRunId: notices[0].id });
				const roleLinks = await attempts(queue, notices[0].id);
				expect(
					roleLinks
						.filter((attempt) => attempt.childWorkflowRunId)
						.map((attempt) => attempt.stepName)
						.sort()
				).toEqual(['email:guest', 'email:host']);
				const generators = workflowRuns.filter(
					(run) => run.workflowName === generateVideoChat.name
				);
				const expectedPurpose =
					choice === 'manual-force' ? 'video-chat-added' : choice === 'suppress' ? null : undefined;
				expect(generators).toHaveLength(expectedPurpose === undefined ? 0 : 1);
				if (generators.length)
					expect(generators[0].input).toEqual({
						appointmentId: input.appointmentId,
						notificationKind: expectedPurpose
					});
				expect(send).toHaveBeenCalledTimes(2);
			} finally {
				await queue.close();
			}
		}
	);

	test.each(['unchanged', 'replaced'] as const)(
		'legacy Reconcile Added checkpoints its expected URI before Notify prepares (%s)',
		async (choice) => {
			const expectedUrl = 'https://cloud.example.com/call/generated';
			await db
				.updateTable('appointments')
				.set({ status: 'confirmed', video_chat: expectedUrl })
				.execute();
			const queue = openQueue(':memory:', async (name) => {
				if (name === 'prepare-emails' && choice === 'replaced') {
					await db
						.updateTable('appointments')
						.set({
							video_chat: 'https://chosen.example.com/replacement',
							video_chat_request: 'suppress'
						})
						.execute();
				}
			});
			try {
				const parent = await queue.client.runWorkflow(reconcileAppointment, {
					...input,
					emailKind: 'video-chat-added'
				});
				await finish(queue, parent.workflowRun.id);
				const preparation = await attempts(queue, parent.workflowRun.id, 'prepare-notification');
				const expectedInput = {
					appointmentId: input.appointmentId,
					kind: 'video-chat-added',
					videoChatUrl: expectedUrl
				};
				expect(preparation).toHaveLength(1);
				expect(preparation[0]).toMatchObject({ status: 'completed', output: expectedInput });
				const workflowRuns = await runs(queue);
				const notices = workflowRuns.filter((run) => run.workflowName === notifyAppointment.name);
				expect(notices).toHaveLength(1);
				expect(notices[0]).toMatchObject({
					status: 'completed',
					input: expectedInput,
					output: choice === 'unchanged' ? { videoChatUrl: expectedUrl } : null
				});
				expect(send).toHaveBeenCalledTimes(choice === 'unchanged' ? 2 : 0);
			} finally {
				await queue.close();
			}
		}
	);

	test.each(['pending', 'confirmed'] as const)(
		'a stale %s request with the opposite current status creates no notice or generator',
		async (kind) => {
			configureVideo();
			await db
				.updateTable('appointments')
				.set({ status: kind === 'pending' ? 'confirmed' : 'pending' })
				.execute();
			const queue = openQueue();
			try {
				const parent = await queue.client.runWorkflow(reconcileAppointment, {
					appointmentId: input.appointmentId,
					emailKind: kind
				});
				await finish(queue, parent.workflowRun.id);
				const workflowRuns = await runs(queue);
				expect(workflowRuns).toHaveLength(1);
				expect(send).not.toHaveBeenCalled();
			} finally {
				await queue.close();
			}
		}
	);

	test('retries transient SMTP failures and logs done only after both roles recover', async () => {
		const counts = failingMailer({ guest: 2, host: 2 });
		const queue = openQueue();
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, input);
			await startParentAndExpectChildren(queue);
			await finish(queue, parent.workflowRun.id);
			const reconciliationResult = await parent.result({ timeoutMs: 500 });
			expect(reconciliationResult).toBe('reconciled');
			expect(counts).toEqual({ guest: 3, host: 3 });
			const states = await emailStates();
			expect(states).toEqual(['failed', 'failed', 'failed', 'failed', 'done']);
			const serviceStatus = await db
				.selectFrom('service_status')
				.select(['error', 'via'])
				.where('kind', '=', 'smtp')
				.executeTakeFirstOrThrow();
			expect(serviceStatus).toEqual({ error: null, via: 'send' });
			const deliveryRuns = await children(queue);
			for (const child of deliveryRuns) {
				const stepAttempts = await attempts(queue, child.id, 'smtp');
				expect(stepAttempts.map((attempt) => attempt.status)).toEqual([
					'failed',
					'failed',
					'completed'
				]);
			}
			const workflowRuns = await runs(queue);
			expect(workflowRuns).toHaveLength(4);
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
				const noticeId = await notificationId(queue);
				const links = await attempts(queue, noticeId);
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
				const states = await emailStates();
				expect(states).toEqual(Array(9).fill('failed'));
				const deliveryRuns = await children(queue);
				for (const child of deliveryRuns) {
					const role = (child.input as { role: RecipientRole }).role;
					expect(child.status).toBe(role === failedRole ? 'failed' : 'completed');
					const stepAttempts = await attempts(queue, child.id, 'smtp');
					expect(stepAttempts).toHaveLength(5);
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
			const deliveryRuns = await children(queue);
			expect(deliveryRuns.map((child) => child.status)).toEqual(['failed', 'failed']);
			const states = await emailStates();
			expect(states).toEqual(Array(10).fill('failed'));
			const serviceStatus = await db
				.selectFrom('service_status')
				.select('error')
				.where('kind', '=', 'smtp')
				.executeTakeFirstOrThrow();
			expect(serviceStatus).toEqual({
				error: expect.stringMatching(/^SMTP (guest|host) unavailable$/)
			});
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
			const deliveryRuns = await children(queue);
			expect(
				deliveryRuns.map((child) => (child.input as { role: RecipientRole }).role).sort()
			).toEqual(['guest', 'host']);
			const states = await emailStates();
			expect(states).toEqual(['done']);
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
			const deliveryRuns = await children(queue);
			expect(deliveryRuns.map((child) => child.input)).toEqual([
				expect.objectContaining({ role: 'host' })
			]);
			const states = await emailStates();
			expect(states).toEqual(['done']);
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
				const reconciliationResult = await parent.result({ timeoutMs: 500 });
				expect(reconciliationResult).toBe('reconciled');
				expect(send).not.toHaveBeenCalled();
				const deliveryRuns = await children(queue);
				expect(deliveryRuns).toEqual([]);
				const states = await emailStates();
				expect(states).toEqual([]);
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
				const deliveryRuns = await children(queue);
				expect(deliveryRuns.map((child) => child.output)).toEqual(['skipped', 'skipped']);
				const states = await emailStates();
				expect(states).toEqual([]);
				const serviceStatus = await db.selectFrom('service_status').selectAll().execute();
				expect(serviceStatus).toEqual([]);
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
			const deliveryRuns = await children(queue);
			expect(deliveryRuns.map((child) => child.output).sort()).toEqual(['sent', 'skipped']);
			const states = await emailStates();
			expect(states).toEqual([]);
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
					emailKind: 'edited-by-host',
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
			await db.updateTable('appointments').set({ status: 'confirmed' }).execute();
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
			const deliveryRuns = await children(queue);
			expect(deliveryRuns.map((child) => child.id).sort()).toEqual(
				savedChildren.map((child) => child.id).sort()
			);
			expect(external).toHaveBeenCalledTimes(1);
			const noticeId = await notificationId(queue);
			const stepAttempts = await attempts(queue, noticeId, 'prepare-emails');
			expect(stepAttempts).toHaveLength(1);
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
				await tickAndSettle(queue);
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
		await db.updateTable('appointments').set({ status: 'confirmed' }).execute();
		configureVideo();
		const registerBlockedGeneration = (client: OpenWorkflow) => {
			client.implementWorkflow(generateVideoChat, ({ step }) =>
				step.run({ name: 'blocked-generation', retryPolicy: { initialInterval: '1h' } }, () => {
					throw new Error('provider unavailable');
				})
			);
		};
		let queue = openQueue(join(directory, 'queue.sqlite'), undefined, registerBlockedGeneration);
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, {
				...input,
				emailKind: 'edited-by-host'
			});
			await startParentAndExpectChildren(queue);
			const workflowRuns = await runs(queue);
			const [generator] = workflowRuns.filter((run) => run.workflowName === generateVideoChat.name);
			expect(generator).toMatchObject({
				status: 'pending',
				input: { appointmentId: input.appointmentId, notificationKind: 'video-chat-added' }
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
			queue = openQueue(join(directory, 'queue.sqlite'), undefined, registerBlockedGeneration);
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
							),
						runWorkflow: (...args) => step.runWorkflow(...args)
					},
					clock
				)
			);
		});
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, input);
			await driveUntil(queue, async () => {
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
			const ticked = await tickAndSettle(queue);
			expect(ticked).toBe(1);
			expect(send).toHaveBeenCalledTimes(1);
			const states = await emailStates();
			expect(states).toEqual(['failed']);
			const deliveryRuns = await children(queue);
			const failedChild = deliveryRuns.find(
				(child) => child.status === 'pending' && child.error !== null
			);
			expect(failedChild).toBeDefined();
			await queue.close();
			await db.updateTable('appointments').set({ status: 'purged' }).execute();
			queue = openQueue(join(directory, 'queue.sqlite'));
			await finish(queue, parent.workflowRun.id);
			expect(send).toHaveBeenCalledTimes(1);
			const replayedDeliveries = await children(queue);
			expect(replayedDeliveries.map((child) => child.output)).toEqual(['skipped', 'skipped']);
			const replayedStates = await emailStates();
			expect(replayedStates).toEqual(['failed']);
			const stepAttempts = await attempts(queue, failedChild!.id, 'smtp');
			expect(stepAttempts.map((attempt) => attempt.status)).toEqual(['failed', 'completed']);
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
			const deliveryRuns = await children(queue);
			expect(deliveryRuns.map((child) => child.output)).toEqual(['sent', 'sent']);
			const states = await emailStates();
			expect(states).toEqual([]);
		} finally {
			await queue.close();
		}
	});

	test('saved SMTP success replays its original timestamp over a newer failure without resending', async () => {
		let now = at;
		vi.spyOn(clock, 'now').mockImplementation(() => new Date(now));
		const directory = await mkdtemp(join(tmpdir(), 'when-email-status-'));
		await db.updateTable('appointments').set({ guest_email: null }).execute();
		const bookkeeping = vi
			.spyOn(status, 'recordSendOutcome')
			.mockRejectedValueOnce(new Error('local status failure'));
		let queue = openQueue(join(directory, 'queue.sqlite'));
		try {
			const parent = await queue.client.runWorkflow(reconcileAppointment, input);
			await startParentAndExpectChildren(queue, 1);
			await driveUntil(queue, async () => {
				const [child] = await children(queue);
				expect(child).toMatchObject({ status: 'pending', workerId: null });
				const stepAttempts = await attempts(queue, child.id, 'smtp:status');
				expect(stepAttempts.map((attempt) => attempt.status)).toEqual(['failed']);
			});
			const [child] = await children(queue);
			const savedSmtp = await attempts(queue, child.id, 'smtp');
			expect(savedSmtp).toHaveLength(1);
			expect(savedSmtp[0].status).toBe('completed');
			const states = await emailStates();
			expect(states).toEqual([]);
			await queue.close();
			now = '2026-02-01T12:05:00.000Z';
			await recordServiceOutcome(
				db,
				{ kind: 'smtp' },
				{ at: now, via: 'send', error: 'later SMTP failure' }
			);
			const newerFailure = await db
				.selectFrom('service_status')
				.selectAll()
				.where('kind', '=', 'smtp')
				.executeTakeFirstOrThrow();
			expect(newerFailure).toMatchObject({
				last_attempt_at: now,
				last_ok_at: null,
				failing_since: now,
				error: 'later SMTP failure',
				via: 'send'
			});
			now = '2026-02-01T12:10:00.000Z';
			bookkeeping.mockRestore();
			queue = openQueue(join(directory, 'queue.sqlite'));
			await finish(queue, parent.workflowRun.id);
			expect(send).toHaveBeenCalledTimes(1);
			const replayedSmtp = await attempts(queue, child.id, 'smtp');
			expect(replayedSmtp).toEqual(savedSmtp);
			const replayedStatus = await attempts(queue, child.id, 'smtp:status');
			expect(replayedStatus.map((attempt) => attempt.status)).toEqual(['failed', 'completed']);
			const replayedStates = await emailStates();
			expect(replayedStates).toEqual(['done']);
			const replayedDeliveries = await children(queue);
			expect(replayedDeliveries.map((delivery) => delivery.output)).toEqual(['sent']);
			const replayedSuccess = await db
				.selectFrom('service_status')
				.selectAll()
				.where('kind', '=', 'smtp')
				.executeTakeFirstOrThrow();
			expect(replayedSuccess).toMatchObject({
				last_attempt_at: at,
				last_ok_at: at,
				failing_since: null,
				error: null,
				via: 'send'
			});
			expect(replayedSuccess.last_attempt_at! < newerFailure.last_attempt_at!).toBe(true);
			expect(savedSmtp[0].output).toBe(at);
		} finally {
			try {
				await queue.close();
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}
	});
});
