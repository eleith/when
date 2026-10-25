import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { OpenWorkflow } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import { generateVideoChat, getOpenWorkflow, reconcileAppointment } from '@when/jobs';
import {
	deleteAppointmentFromCalendar,
	getGoogleEvent,
	patchGoogleEvent,
	pushAppointment
} from '@when/calendar';
import { findAppointment, openDb, parseActionLog, runMigrations } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';
import type { Envelope } from '../email/recipients.js';
import type { SendResult } from '../email/smtp.js';
import { getWorkerContext, setWorkerContext } from '../services/context.js';
import { scanOnce } from '../calendar/sync.js';
import { createLogger } from '../services/logger.js';
import { tickAndSettle } from './__fixtures__/tick-and-settle.js';
import { runGenerateVideoChat } from './generate-video-chat.js';
import { notifyAppointment, runNotifyAppointment } from './notify-appointment.js';
import { runReconcileAppointment } from './reconcile-appointment.js';
import {
	deliverAppointmentEmail,
	runDeliverAppointmentEmail
} from './deliver-appointment-email.js';

vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return { ...actual, getOpenWorkflow: vi.fn() };
});
vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return {
		...actual,
		pushAppointment: vi.fn(),
		deleteAppointmentFromCalendar: vi.fn(),
		getGoogleEvent: vi.fn(),
		patchGoogleEvent: vi.fn()
	};
});

const appointmentId = sampleAppointment.id;
const reference = { calendarId: 'work', eventId: 'booked-event' };
const uri = 'https://meet.example.com/generated';
const clock = { now: () => new Date('2026-02-01T12:00:00.000Z') };
let directory: string;
let db: ReturnType<typeof openDb>;
let config: WhenConfiguration;
let send: ReturnType<typeof vi.fn<(envelope: Envelope) => Promise<SendResult>>>;
let conference: 'absent' | 'pending' | 'ready' | 'failed';
let requestOutcome: 'pending' | 'ready';

function event() {
	if (conference === 'absent') return { id: reference.eventId };
	let statusCode = 'pending';
	if (conference === 'ready') statusCode = 'success';
	if (conference === 'failed') statusCode = 'failure';
	const entryPoints = conference === 'ready' ? [{ entryPointType: 'video', uri }] : [];
	return {
		id: reference.eventId,
		conferenceData: { createRequest: { status: { statusCode } }, entryPoints }
	};
}

// These restarts reuse saved successes; effects before their checkpoint remain at-least-once.
function openQueue(beforeGenerationStep?: (name: string) => Promise<void>) {
	const backend = BackendSqlite.connect(join(directory, 'queue.sqlite'));
	const client = new OpenWorkflow({ backend });
	vi.mocked(getOpenWorkflow).mockReturnValue(client);
	client.implementWorkflow(generateVideoChat, ({ input, step }) =>
		runGenerateVideoChat(
			input,
			{
				run: (settings, fn) =>
					step.run(
						{
							...settings,
							retryPolicy: {
								...settings.retryPolicy,
								initialInterval: '1ms',
								maximumInterval: '1ms'
							}
						},
						async () => {
							await beforeGenerationStep?.(settings.name);
							const result = await fn();
							return result;
						}
					),
				runWorkflow: (...args) => step.runWorkflow(...args)
			},
			clock
		)
	);
	client.implementWorkflow(reconcileAppointment, ({ input, step }) =>
		runReconcileAppointment(input, {
			run: (settings, fn) =>
				step.run(
					{
						...settings,
						retryPolicy: { initialInterval: '1ms', maximumInterval: '1ms' }
					},
					fn
				),
			runWorkflow: (...args) => step.runWorkflow(...args)
		})
	);
	client.implementWorkflow(notifyAppointment, ({ input, step }) =>
		runNotifyAppointment(input, step, clock)
	);
	client.implementWorkflow(deliverAppointmentEmail, ({ input, step }) =>
		runDeliverAppointmentEmail(
			input,
			{
				run: (settings, fn) =>
					step.run(
						{
							...settings,
							retryPolicy: {
								...settings.retryPolicy,
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
async function attempts(queue: Queue, workflowRunId: string, stepName: string) {
	const page = await queue.backend.listStepAttempts({ workflowRunId, limit: 100 });
	expect(page.pagination.next).toBeNull();
	return page.data.filter((attempt) => attempt.stepName === stepName);
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
async function finishAll(queue: Queue) {
	await driveUntil(queue, async () => {
		const workflowRuns = await runs(queue);
		expect(workflowRuns.every((run) => run.status === 'completed')).toBe(true);
	});
}

beforeEach(async () => {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'when-generate-video-'));
	directory = temporaryDirectory;
	db = openDb(join(directory, 'app.sqlite'));
	await runMigrations(db);
	await db
		.insertInto('appointments')
		.values({
			...sampleAppointment,
			external_calendar_id: reference.calendarId,
			external_event_id: reference.eventId
		})
		.execute();
	config = structuredClone(sampleConfig);
	config.providers = {
		google: {
			type: 'google',
			client_id: 'test-client',
			client_secret: 'test-secret',
			refresh_token: 'test-token',
			calendars: { work: { id: 'remote-calendar', sync: { refresh_every_minutes: 10 } } }
		}
	};
	config.meetings = {
		'30-min': {
			title: 'Original meeting',
			booking_calendar: 'work',
			schedule: 'standard',
			video_chat: { provider: 'google', attach: { auto: true } }
		}
	} as unknown as WhenConfiguration['meetings'];
	send = vi.fn(async () => ({ ok: true }));
	setWorkerContext({ db, config, mailer: { send }, logger: createLogger() });
	conference = 'absent';
	requestOutcome = 'ready';
	vi.mocked(getGoogleEvent).mockImplementation(async () => event());
	vi.mocked(patchGoogleEvent).mockImplementation(async (_config, _id, fields) => {
		conference = fields.conferenceData === null ? 'absent' : requestOutcome;
		return event();
	});
	vi.mocked(pushAppointment).mockResolvedValue({
		ok: true,
		externalCalendarId: reference.calendarId,
		externalEventId: reference.eventId
	});
	vi.mocked(deleteAppointmentFromCalendar).mockResolvedValue({ ok: true });
	vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network call'));
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	await db.destroy();
	await rm(directory, { recursive: true, force: true });
});

describe('durable background video generation with native concurrency one', () => {
	test.each(['pending', 'confirmed'] as const)(
		'automatic ready first sends one full %s notice with the link and no added notice',
		async (kind) => {
			await db.updateTable('appointments').set({ status: kind }).execute();
			const queue = openQueue();
			try {
				await queue.client.runWorkflow(reconcileAppointment, { appointmentId, emailKind: kind });
				await finishAll(queue);
				const workflowRuns = await runs(queue);
				const notices = workflowRuns.filter((run) => run.workflowName === notifyAppointment.name);
				expect(notices).toHaveLength(1);
				expect(notices[0].input).toEqual({ appointmentId, kind });
				const generator = workflowRuns.find((run) => run.workflowName === generateVideoChat.name)!;
				expect(generator.input).toEqual({ appointmentId, notificationKind: kind });
				const firstRequest = await attempts(queue, generator.id, 'initial-video-request');
				expect(firstRequest).toHaveLength(1);
				expect(firstRequest[0]).toMatchObject({
					status: 'completed',
					output: { ok: true, attempt: { status: 'ready', url: uri } }
				});
				const bookings = await attempts(queue, generator.id, 'book-google-event');
				expect(bookings).toEqual([]);
				expect(send).toHaveBeenCalledTimes(2);
				for (const [envelope] of send.mock.calls) {
					expect(envelope.subject).not.toMatch(/^Video link added:/);
					expect(envelope.text).toContain(uri);
				}
				const row = await findAppointment(db, appointmentId);
				expect(row).toMatchObject({ video_chat: uri, calendar_revision: 1, ics_sequence: 1 });
				expect(patchGoogleEvent).toHaveBeenCalledTimes(1);
				expect(globalThis.fetch).not.toHaveBeenCalled();
			} finally {
				await queue.close();
			}
		}
	);

	test.each(['pending', 'failure'] as const)(
		'automatic first %s checkpoints the full no-link notice before retries and does not repeat it after restart',
		async (outcome) => {
			requestOutcome = outcome === 'pending' ? 'pending' : 'ready';
			if (outcome === 'failure')
				vi.mocked(patchGoogleEvent).mockRejectedValueOnce(new Error('Google PATCH HTTP 503'));
			const retryStep = outcome === 'pending' ? 'read-pending-video-chat' : 'book-google-event';
			let queue = openQueue(async (name) => {
				if (name === retryStep) {
					expect(send).toHaveBeenCalledTimes(2);
					for (const [envelope] of send.mock.calls) expect(envelope.text).not.toContain(uri);
					throw new Error('retry interrupted after full notice');
				}
			});
			try {
				await queue.client.runWorkflow(reconcileAppointment, {
					appointmentId,
					emailKind: 'confirmed'
				});
				await driveUntil(queue, async () => {
					const workflowRuns = await runs(queue);
					const generator = workflowRuns.find((run) => run.workflowName === generateVideoChat.name);
					expect(generator).toBeDefined();
					const retry = await attempts(queue, generator!.id, retryStep);
					expect(retry.map((attempt) => attempt.status)).toEqual(['failed']);
				});
				const beforeRuns = await runs(queue);
				const generator = beforeRuns.find((run) => run.workflowName === generateVideoChat.name)!;
				const firstRequest = await attempts(queue, generator.id, 'initial-video-request');
				expect(firstRequest).toHaveLength(1);
				expect(firstRequest[0]).toMatchObject({
					status: 'completed',
					output:
						outcome === 'pending'
							? { ok: true, attempt: { status: 'pending', url: null } }
							: { ok: false }
				});
				const fullNotice = beforeRuns.find((run) => run.workflowName === notifyAppointment.name)!;
				expect(fullNotice).toMatchObject({
					status: 'completed',
					input: { appointmentId, kind: 'confirmed' },
					output: { videoChatUrl: null }
				});
				const originalLink = await attempts(queue, generator.id, 'original-notification');
				expect(originalLink).toHaveLength(1);
				expect(originalLink[0]).toMatchObject({
					status: 'completed',
					childWorkflowRunId: fullNotice.id
				});
				expect(patchGoogleEvent).toHaveBeenCalledTimes(1);
				await queue.close();
				if (outcome === 'pending') conference = 'ready';
				queue = openQueue();
				await finishAll(queue);
				const replayedRequest = await attempts(queue, generator.id, 'initial-video-request');
				const replayedLink = await attempts(queue, generator.id, 'original-notification');
				expect(replayedRequest).toEqual(firstRequest);
				expect(replayedLink).toEqual(originalLink);
				const finalRuns = await runs(queue);
				const notices = finalRuns.filter((run) => run.workflowName === notifyAppointment.name);
				expect(notices.map((run) => (run.input as { kind: string }).kind).sort()).toEqual([
					'confirmed',
					'video-chat-added'
				]);
				expect(send).toHaveBeenCalledTimes(4);
				const added = send.mock.calls.slice(2).map(([envelope]) => envelope);
				for (const envelope of added) {
					expect(envelope.subject).toMatch(/^Video link added:/);
					expect(envelope.text).toContain(uri);
					expect(envelope.text).not.toMatch(/approved|confirmed by|host added/i);
				}
				expect(patchGoogleEvent).toHaveBeenCalledTimes(outcome === 'pending' ? 1 : 2);
				const row = await findAppointment(db, appointmentId);
				expect(row).toMatchObject({ video_chat: uri, calendar_revision: 1, ics_sequence: 1 });
			} finally {
				await queue.close();
			}
		}
	);

	test('approval while the original pending notice is parked stops its failed-request continuation', async () => {
		await db.updateTable('appointments').set({ status: 'pending' }).execute();
		vi.mocked(patchGoogleEvent).mockRejectedValueOnce(new Error('Google PATCH HTTP 503'));
		send.mockResolvedValueOnce({ ok: false, reason: 'temporary SMTP failure' });
		const queue = openQueue();
		try {
			const generation = await queue.client.runWorkflow(generateVideoChat, {
				appointmentId,
				notificationKind: 'pending'
			});
			await driveUntil(queue, async () => {
				const workflowRuns = await runs(queue);
				const parkedDelivery = workflowRuns.find(
					(run) =>
						run.workflowName === deliverAppointmentEmail.name &&
						run.status === 'pending' &&
						run.error !== null
				);
				expect(parkedDelivery).toBeDefined();
				expect(send).toHaveBeenCalledTimes(1);
			});
			const initialRequest = await attempts(
				queue,
				generation.workflowRun.id,
				'initial-video-request'
			);
			expect(initialRequest).toHaveLength(1);
			expect(initialRequest[0]).toMatchObject({ status: 'completed', output: { ok: false } });
			const readsBeforeApproval = vi.mocked(getGoogleEvent).mock.calls.length;
			const bookingsBeforeApproval = vi.mocked(pushAppointment).mock.calls.length;
			expect(patchGoogleEvent).toHaveBeenCalledTimes(1);

			// Approval's independent confirmation job owns the new revision's notice and video work.
			await db
				.updateTable('appointments')
				.set({ status: 'confirmed', calendar_revision: 1, ics_sequence: 1 })
				.execute();
			await finishAll(queue);
			const workflowRuns = await runs(queue);
			const notices = workflowRuns.filter((run) => run.workflowName === notifyAppointment.name);
			expect(notices).toHaveLength(1);
			expect(notices[0]).toMatchObject({
				status: 'completed',
				input: { appointmentId, kind: 'pending' },
				output: { videoChatUrl: null }
			});
			const deliveries = workflowRuns.filter(
				(run) => run.workflowName === deliverAppointmentEmail.name
			);
			expect(deliveries).toHaveLength(2);
			for (const delivery of deliveries) {
				expect(delivery).toMatchObject({
					status: 'completed',
					output: 'sent',
					input: { kind: 'pending' }
				});
			}
			expect(send).toHaveBeenCalledTimes(3);
			for (const [envelope] of send.mock.calls) expect(envelope.text).not.toContain(uri);
			for (const stepName of ['book-google-event', 'request-video-chat', 'publish-video-chat']) {
				const continuation = await attempts(queue, generation.workflowRun.id, stepName);
				expect(continuation).toHaveLength(1);
				expect(continuation[0]).toMatchObject({ status: 'completed', output: null });
			}
			expect(patchGoogleEvent).toHaveBeenCalledTimes(1);
			expect(getGoogleEvent).toHaveBeenCalledTimes(readsBeforeApproval);
			expect(pushAppointment).toHaveBeenCalledTimes(bookingsBeforeApproval);
			const current = await findAppointment(db, appointmentId);
			expect(current).toMatchObject({
				status: 'confirmed',
				video_chat: null,
				calendar_revision: 1,
				ics_sequence: 1
			});
			expect(
				parseActionLog(current!.action_log).filter((entry) => entry.action === 'edit')
			).toEqual([]);
		} finally {
			await queue.close();
		}
	});

	test('approval before replay cleans a checkpointed continuation room after the original pending notice', async () => {
		await db.updateTable('appointments').set({ status: 'pending' }).execute();
		config.providers.cloud = {
			type: 'nextcloud',
			url: 'https://cloud.example.com',
			username: 'user',
			password: 'secret',
			calendars: {}
		};
		config.meetings['30-min'].video_chat = { provider: 'cloud', attach: { auto: true } };
		const roomUrl = 'https://cloud.example.com/call/unpublished';
		const endpoint = 'https://cloud.example.com/ocs/v2.php/apps/spreed/api/v4/room';
		let posts = 0;
		vi.mocked(globalThis.fetch).mockImplementation(async (url, options) => {
			if (url === endpoint && options?.method === 'POST') {
				posts += 1;
				if (posts === 1) return new Response('provider unavailable', { status: 503 });
				return Response.json({ ocs: { data: { token: 'unpublished' } } });
			}
			if (url === `${endpoint}/unpublished` && options?.method === 'DELETE')
				return new Response(null, { status: 204 });
			throw new Error('Unexpected network call');
		});
		let queue = openQueue(async (name) => {
			if (name === 'publish-video-chat')
				throw new Error('interrupted before continuation publication');
		});
		try {
			const generation = await queue.client.runWorkflow(generateVideoChat, {
				appointmentId,
				notificationKind: 'pending'
			});
			await driveUntil(queue, async () => {
				const publication = await attempts(queue, generation.workflowRun.id, 'publish-video-chat');
				expect(publication.map((attempt) => attempt.status)).toEqual(['failed']);
			});
			const firstRequest = await attempts(
				queue,
				generation.workflowRun.id,
				'initial-video-request'
			);
			expect(firstRequest[0]).toMatchObject({ status: 'completed', output: { ok: false } });
			const savedRequest = await attempts(queue, generation.workflowRun.id, 'request-video-chat');
			expect(savedRequest).toHaveLength(1);
			expect(savedRequest[0]).toMatchObject({
				status: 'completed',
				output: { status: 'ready', url: roomUrl, target: { revision: 0 } }
			});
			const originalNotice = await attempts(
				queue,
				generation.workflowRun.id,
				'original-notification'
			);
			expect(originalNotice[0]).toMatchObject({
				status: 'completed',
				output: { videoChatUrl: null }
			});
			expect(posts).toBe(2);
			expect(send).toHaveBeenCalledTimes(2);
			await queue.close();

			await db
				.updateTable('appointments')
				.set({ status: 'confirmed', calendar_revision: 1, ics_sequence: 1 })
				.execute();
			queue = openQueue();
			await finishAll(queue);
			const replayedRequest = await attempts(
				queue,
				generation.workflowRun.id,
				'request-video-chat'
			);
			expect(replayedRequest).toEqual(savedRequest);
			const replayedNotice = await attempts(
				queue,
				generation.workflowRun.id,
				'original-notification'
			);
			expect(replayedNotice).toEqual(originalNotice);
			const publication = await attempts(queue, generation.workflowRun.id, 'publish-video-chat');
			expect(publication.map((attempt) => attempt.status)).toEqual(['failed', 'completed']);
			expect(publication[1].output).toBeNull();
			const cleanup = await attempts(queue, generation.workflowRun.id, 'cleanup-unused-video-chat');
			expect(cleanup).toHaveLength(1);
			expect(cleanup[0].status).toBe('completed');
			const completedGeneration = await queue.backend.getWorkflowRun({
				workflowRunId: generation.workflowRun.id
			});
			expect(completedGeneration).toMatchObject({ status: 'completed', output: { url: null } });
			expect(vi.mocked(globalThis.fetch).mock.calls.map(([, options]) => options?.method)).toEqual([
				'POST',
				'POST',
				'DELETE'
			]);
			expect(globalThis.fetch).toHaveBeenLastCalledWith(
				`${endpoint}/unpublished`,
				expect.objectContaining({ method: 'DELETE' })
			);
			const workflowRuns = await runs(queue);
			const notices = workflowRuns.filter((run) => run.workflowName === notifyAppointment.name);
			expect(notices).toHaveLength(1);
			expect(notices[0]).toMatchObject({
				input: { appointmentId, kind: 'pending' },
				output: { videoChatUrl: null }
			});
			expect(send).toHaveBeenCalledTimes(2);
			for (const [envelope] of send.mock.calls) expect(envelope.text).not.toContain(roomUrl);
			const current = await findAppointment(db, appointmentId);
			expect(current).toMatchObject({
				status: 'confirmed',
				video_chat: null,
				calendar_revision: 1,
				ics_sequence: 1
			});
			expect(
				parseActionLog(current!.action_log).filter((entry) => entry.action === 'edit')
			).toEqual([]);
		} finally {
			await queue.close();
		}
	});

	test.each(['replace-uri', 'replace-and-suppress', 'suppress-same-uri'] as const)(
		'a host choice during late notification sync (%s) cannot fabricate an Added notice',
		async (choice) => {
			vi.mocked(patchGoogleEvent).mockRejectedValueOnce(new Error('Google PATCH HTTP 503'));
			const selectedUrl =
				choice === 'suppress-same-uri' ? uri : 'https://chosen.example.com/replacement';
			const requestChoice = choice === 'replace-uri' ? null : 'suppress';
			let hostEdited = false;
			const queue = openQueue(async (name) => {
				if (name !== 'sync-video-notification') return;
				expect(send).toHaveBeenCalledTimes(2);
				const published = await findAppointment(db, appointmentId);
				expect(published).toMatchObject({ video_chat: uri, calendar_revision: 1, ics_sequence: 1 });
				await db
					.updateTable('appointments')
					.set({
						video_chat: selectedUrl,
						video_chat_request: requestChoice,
						calendar_revision: 2,
						ics_sequence: 2
					})
					.execute();
				hostEdited = true;
			});
			try {
				await queue.client.runWorkflow(reconcileAppointment, {
					appointmentId,
					emailKind: 'confirmed'
				});
				await finishAll(queue);
				expect(hostEdited).toBe(true);
				const workflowRuns = await runs(queue);
				const fullNotice = workflowRuns.find(
					(run) =>
						run.workflowName === notifyAppointment.name &&
						(run.input as { kind: string }).kind === 'confirmed'
				);
				expect(fullNotice).toMatchObject({
					status: 'completed',
					input: { appointmentId, kind: 'confirmed' },
					output: { videoChatUrl: null }
				});
				const addedNotice = workflowRuns.find(
					(run) =>
						run.workflowName === notifyAppointment.name &&
						(run.input as { kind: string }).kind === 'video-chat-added'
				);
				expect(addedNotice).toMatchObject({
					status: 'completed',
					input: { appointmentId, kind: 'video-chat-added', videoChatUrl: uri },
					output: null
				});
				const addedPreparation = await attempts(queue, addedNotice!.id, 'prepare-emails');
				expect(addedPreparation).toHaveLength(1);
				expect(addedPreparation[0]).toMatchObject({ status: 'completed', output: null });
				const deliveries = workflowRuns.filter(
					(run) => run.workflowName === deliverAppointmentEmail.name
				);
				expect(deliveries).toHaveLength(2);
				expect(
					deliveries.every((run) => (run.input as { kind: string }).kind === 'confirmed')
				).toBe(true);
				expect(send).toHaveBeenCalledTimes(2);
				for (const [envelope] of send.mock.calls) {
					expect(envelope.subject).not.toMatch(/^Video link added:/);
					expect(envelope.text).not.toContain(uri);
					expect(envelope.text).not.toContain(selectedUrl);
				}
				const current = await findAppointment(db, appointmentId);
				expect(current).toMatchObject({
					video_chat: selectedUrl,
					video_chat_request: requestChoice,
					calendar_revision: 2,
					ics_sequence: 2
				});
			} finally {
				await queue.close();
			}
		}
	);

	test('accepted pending requests remain GET-only through absent and failed observations after restart', async () => {
		requestOutcome = 'pending';
		let queue = openQueue();
		try {
			const generation = await queue.client.runWorkflow(generateVideoChat, {
				appointmentId,
				notificationKind: 'confirmed'
			});
			await driveUntil(queue, async () => {
				const reads = await attempts(queue, generation.workflowRun.id, 'read-pending-video-chat');
				expect(reads.map((attempt) => attempt.status)).toEqual(['failed']);
			});
			expect(send).toHaveBeenCalledTimes(2);
			await queue.close();
			queue = openQueue();
			let expectedReadAttempts = 1;
			for (const state of ['absent', 'failed'] as const) {
				conference = state;
				expectedReadAttempts += 1;
				await driveUntil(queue, async () => {
					const reads = await attempts(queue, generation.workflowRun.id, 'read-pending-video-chat');
					expect(reads).toHaveLength(expectedReadAttempts);
					expect(reads.every((attempt) => attempt.status === 'failed')).toBe(true);
				});
				expect(patchGoogleEvent).toHaveBeenCalledTimes(1);
				expect(send).toHaveBeenCalledTimes(2);
			}
			conference = 'ready';
			await finishAll(queue);
			const reads = await attempts(queue, generation.workflowRun.id, 'read-pending-video-chat');
			expect(reads.map((attempt) => attempt.status)).toEqual([
				'failed',
				'failed',
				'failed',
				'completed'
			]);
			expect(patchGoogleEvent).toHaveBeenCalledTimes(1);
			expect(send).toHaveBeenCalledTimes(4);
		} finally {
			await queue.close();
		}
	});

	test.each(['missing', 'existing'] as const)(
		'manual generation with %s selection sends only an actually materialized added notice',
		async (selection) => {
			config.meetings['30-min'].video_chat!.attach = { auto: false };
			await db
				.updateTable('appointments')
				.set({ video_chat_request: 'generate', video_chat: selection === 'missing' ? null : uri })
				.execute();
			const queue = openQueue();
			try {
				await queue.client.runWorkflow(generateVideoChat, {
					appointmentId,
					notificationKind: 'video-chat-added'
				});
				await finishAll(queue);
				const workflowRuns = await runs(queue);
				const notices = workflowRuns.filter((run) => run.workflowName === notifyAppointment.name);
				expect(notices).toHaveLength(selection === 'missing' ? 1 : 0);
				expect(send).toHaveBeenCalledTimes(selection === 'missing' ? 2 : 0);
				for (const [envelope] of send.mock.calls)
					expect(envelope.subject).toMatch(/^Video link added:/);
				expect(patchGoogleEvent).toHaveBeenCalledTimes(selection === 'missing' ? 1 : 0);
			} finally {
				await queue.close();
			}
		}
	);

	test('cleanup-only purpose cannot create an automatically wanted link or send mail', async () => {
		const queue = openQueue();
		try {
			await queue.client.runWorkflow(generateVideoChat, { appointmentId, notificationKind: null });
			await finishAll(queue);
			const workflowRuns = await runs(queue);
			expect(workflowRuns).toHaveLength(1);
			expect(workflowRuns[0]).toMatchObject({ status: 'completed', output: { url: null } });
			expect(send).not.toHaveBeenCalled();
			expect(patchGoogleEvent).not.toHaveBeenCalled();
			expect(pushAppointment).not.toHaveBeenCalled();
		} finally {
			await queue.close();
		}
	});

	test('the added notification checkpoints neutral envelopes before restart, independently of later row and config changes', async () => {
		config.meetings['30-min'].video_chat!.attach = { auto: false };
		await db.updateTable('appointments').set({ video_chat_request: 'generate' }).execute();
		let queue = openQueue();
		try {
			await queue.client.runWorkflow(generateVideoChat, {
				appointmentId,
				notificationKind: 'video-chat-added'
			});
			await driveUntil(queue, async () => {
				const workflowRuns = await runs(queue);
				const deliveries = workflowRuns.filter(
					(run) => run.workflowName === deliverAppointmentEmail.name
				);
				expect(deliveries).toHaveLength(2);
				expect(deliveries.every((run) => run.status === 'pending')).toBe(true);
			});
			const savedRuns = await runs(queue);
			const savedDeliveries = savedRuns.filter(
				(run) => run.workflowName === deliverAppointmentEmail.name
			);
			const savedEnvelopes = savedDeliveries.map(
				(run) => (run.input as unknown as { envelope: Envelope }).envelope
			);
			for (const envelope of savedEnvelopes) {
				expect(envelope.subject).toMatch(/^Video link added:/);
				expect(envelope.text).toContain(uri);
				expect(envelope.text).not.toMatch(/approved|confirmed by|host added/i);
			}
			expect(
				savedEnvelopes.some((envelope) =>
					envelope.attachments?.some((attachment) => attachment.content.includes('SEQUENCE:1'))
				)
			).toBe(true);
			await queue.close();
			await db
				.updateTable('appointments')
				.set({
					guest_name: 'Changed guest',
					guest_email: 'changed@example.com',
					video_chat: 'https://chosen.example.com/replacement',
					video_chat_request: 'suppress',
					calendar_revision: 2,
					ics_sequence: 2
				})
				.execute();
			config.user.email = 'changed-owner@example.com';
			config.meetings['30-min'].title = 'Changed title';
			queue = openQueue();
			await finishAll(queue);
			const finalRuns = await runs(queue);
			const finalDeliveries = finalRuns.filter(
				(run) => run.workflowName === deliverAppointmentEmail.name
			);
			expect(finalDeliveries.map((run) => ({ id: run.id, input: run.input }))).toEqual(
				savedDeliveries.map((run) => ({ id: run.id, input: run.input }))
			);
			expect(send.mock.calls.map(([envelope]) => envelope)).toEqual(
				expect.arrayContaining(savedEnvelopes)
			);
			expect(send).toHaveBeenCalledTimes(2);
			expect(patchGoogleEvent).toHaveBeenCalledTimes(1);
		} finally {
			await queue.close();
		}
	});

	test('a full original notice is still owed when the current row already selects a link at generation start', async () => {
		await db.updateTable('appointments').set({ video_chat: uri }).execute();
		const queue = openQueue();
		try {
			await queue.client.runWorkflow(generateVideoChat, {
				appointmentId,
				notificationKind: 'confirmed'
			});
			await finishAll(queue);
			expect(send).toHaveBeenCalledTimes(2);
			for (const [envelope] of send.mock.calls) {
				expect(envelope.subject).not.toMatch(/^Video link added:/);
				expect(envelope.text).toContain(uri);
			}
			expect(patchGoogleEvent).not.toHaveBeenCalled();
			const workflowRuns = await runs(queue);
			expect(
				workflowRuns.filter((run) => run.workflowName === notifyAppointment.name)
			).toHaveLength(1);
		} finally {
			await queue.close();
		}
	});

	test.each(['cancelled', 'purged', 'approved'] as const)(
		'obsolete original pending notice after %s fabricates no mail',
		async (state) => {
			await db
				.updateTable('appointments')
				.set({
					status: state === 'approved' ? 'confirmed' : state,
					video_chat: state === 'approved' ? uri : null
				})
				.execute();
			const queue = openQueue();
			try {
				await queue.client.runWorkflow(generateVideoChat, {
					appointmentId,
					notificationKind: 'pending'
				});
				await finishAll(queue);
				expect(send).not.toHaveBeenCalled();
				expect(patchGoogleEvent).not.toHaveBeenCalled();
				const workflowRuns = await runs(queue);
				expect(
					workflowRuns.filter((run) => run.workflowName === deliverAppointmentEmail.name)
				).toEqual([]);
			} finally {
				await queue.close();
			}
		}
	);

	test('original SMTP exhaustion fails generation before any later provider retry', async () => {
		requestOutcome = 'pending';
		send.mockResolvedValue({ ok: false, reason: 'SMTP unavailable' });
		const queue = openQueue();
		try {
			const generation = await queue.client.runWorkflow(generateVideoChat, {
				appointmentId,
				notificationKind: 'confirmed'
			});
			await driveUntil(queue, async () => {
				const current = await queue.backend.getWorkflowRun({
					workflowRunId: generation.workflowRun.id
				});
				expect(current).toMatchObject({ status: 'failed' });
			});
			const reads = await attempts(queue, generation.workflowRun.id, 'read-pending-video-chat');
			const fallback = await attempts(queue, generation.workflowRun.id, 'book-google-event');
			expect(reads).toEqual([]);
			expect(fallback).toEqual([]);
			const workflowRuns = await runs(queue);
			const roles = workflowRuns.filter((run) => run.workflowName === deliverAppointmentEmail.name);
			expect(roles).toHaveLength(2);
			for (const role of roles) {
				const smtp = await attempts(queue, role.id, 'smtp');
				expect(smtp).toHaveLength(5);
				expect(role.status).toBe('failed');
			}
			expect(patchGoogleEvent).toHaveBeenCalledTimes(1);
			expect(send).toHaveBeenCalledTimes(10);
		} finally {
			await queue.close();
		}
	});

	test('a checkpointed pending request resumes with GET only after restart, never another conference request or booking POST', async () => {
		requestOutcome = 'pending';
		let queue = openQueue();
		try {
			const generation = await queue.client.runWorkflow(generateVideoChat, {
				appointmentId,
				notificationKind: 'video-chat-added'
			});
			await tickAndSettle(queue);
			const parked = await queue.backend.getWorkflowRun({
				workflowRunId: generation.workflowRun.id
			});
			expect(parked).toMatchObject({ status: 'pending', workerId: null });
			const savedRequest = await attempts(queue, generation.workflowRun.id, 'request-video-chat');
			expect(savedRequest).toHaveLength(1);
			expect(savedRequest[0]).toMatchObject({
				status: 'completed',
				output: { status: 'pending', url: null }
			});
			const savedRequestId = await attempts(
				queue,
				generation.workflowRun.id,
				'conference-request-id'
			);
			const firstRead = await attempts(queue, generation.workflowRun.id, 'read-pending-video-chat');
			expect(firstRead.map((attempt) => attempt.status)).toEqual(['failed']);
			expect(patchGoogleEvent).toHaveBeenCalledTimes(1);
			expect(pushAppointment).not.toHaveBeenCalled();
			await queue.close();
			conference = 'ready';
			queue = openQueue();
			await finishAll(queue);
			const replayedRequest = await attempts(
				queue,
				generation.workflowRun.id,
				'request-video-chat'
			);
			const replayedRequestId = await attempts(
				queue,
				generation.workflowRun.id,
				'conference-request-id'
			);
			expect(replayedRequest).toEqual(savedRequest);
			expect(replayedRequestId).toEqual(savedRequestId);
			const reads = await attempts(queue, generation.workflowRun.id, 'read-pending-video-chat');
			expect(reads.map((attempt) => attempt.status)).toEqual(['failed', 'completed']);
			expect(patchGoogleEvent).toHaveBeenCalledTimes(1);
			// The only later push belongs to the notification's normal calendar reconciliation.
			expect(pushAppointment).toHaveBeenCalledTimes(1);
			const row = await findAppointment(db, appointmentId);
			expect(row).toMatchObject({ video_chat: uri, calendar_revision: 1, ics_sequence: 1 });
			const edits = parseActionLog(row!.action_log).filter((entry) => entry.action === 'edit');
			expect(edits).toHaveLength(1);
			expect(send).toHaveBeenCalledTimes(2);
		} finally {
			await queue.close();
		}
	});

	test('the saved publication survives a later edit and restart without another provider request', async () => {
		let queue = openQueue(async (name) => {
			if (name === 'publish-video-chat') {
				await db.updateTable('appointments').set({ ics_sequence: 4 }).execute();
			}
			if (name === 'sync-video-notification') throw new Error('notification enqueue interrupted');
		});
		try {
			const generation = await queue.client.runWorkflow(generateVideoChat, {
				appointmentId,
				notificationKind: 'video-chat-added'
			});
			await tickAndSettle(queue);
			const savedPublication = await attempts(
				queue,
				generation.workflowRun.id,
				'publish-video-chat'
			);
			expect(savedPublication).toHaveLength(1);
			expect(savedPublication[0]).toMatchObject({
				status: 'completed',
				output: 5
			});
			await queue.close();
			await db
				.updateTable('appointments')
				.set({ ics_sequence: 6, calendar_revision: 2, note: 'Later edit' })
				.execute();
			queue = openQueue();
			await finishAll(queue);
			const replayedPublication = await attempts(
				queue,
				generation.workflowRun.id,
				'publish-video-chat'
			);
			expect(replayedPublication).toEqual(savedPublication);
			const workflowRuns = await runs(queue);
			const notifications = workflowRuns.filter(
				(run) => run.workflowName === notifyAppointment.name
			);
			expect(notifications).toHaveLength(1);
			expect(notifications[0]).toMatchObject({
				input: { appointmentId, kind: 'video-chat-added', videoChatUrl: uri }
			});
			const row = await findAppointment(db, appointmentId);
			expect(row).toMatchObject({ ics_sequence: 6, calendar_revision: 2, video_chat: uri });
			const edits = parseActionLog(row!.action_log).filter((entry) => entry.action === 'edit');
			expect(edits).toHaveLength(1);
			expect(patchGoogleEvent).toHaveBeenCalledTimes(1);
		} finally {
			await queue.close();
		}
	});

	test.each(['confirmed', 'video-chat-added'] as const)(
		'a saved standalone %s ready request never repeats its POST when publication resumes after restart',
		async (kind) => {
			const requestStep = kind === 'confirmed' ? 'initial-video-request' : 'request-video-chat';
			const publicationStep = kind === 'confirmed' ? 'publish-initial-video' : 'publish-video-chat';
			config.providers.cloud = {
				type: 'nextcloud',
				url: 'https://cloud.example.com',
				username: 'test-user',
				password: 'test-password',
				calendars: {}
			};
			config.meetings['30-min'].video_chat = { provider: 'cloud', attach: { auto: true } };
			const roomUri = 'https://cloud.example.com/call/saved-room';
			vi.mocked(globalThis.fetch).mockImplementation(
				async () =>
					new Response(JSON.stringify({ ocs: { data: { token: 'saved-room' } } }), {
						status: 201,
						headers: { 'content-type': 'application/json' }
					})
			);
			let queue = openQueue(async (name) => {
				if (name === publicationStep) throw new Error('publication interrupted');
			});
			try {
				const generation = await queue.client.runWorkflow(generateVideoChat, {
					appointmentId,
					notificationKind: kind
				});
				await tickAndSettle(queue);
				const savedRequest = await attempts(queue, generation.workflowRun.id, requestStep);
				expect(savedRequest).toHaveLength(1);
				expect(savedRequest[0]).toMatchObject({
					status: 'completed',
					output:
						kind === 'confirmed'
							? { ok: true, attempt: { status: 'ready', url: roomUri } }
							: { status: 'ready', url: roomUri }
				});
				expect(globalThis.fetch).toHaveBeenCalledTimes(1);
				expect(globalThis.fetch).toHaveBeenCalledWith(
					'https://cloud.example.com/ocs/v2.php/apps/spreed/api/v4/room',
					expect.objectContaining({ method: 'POST' })
				);
				const before = await findAppointment(db, appointmentId);
				expect(before).toMatchObject({ video_chat: null, ics_sequence: 0, calendar_revision: 0 });
				await queue.close();
				queue = openQueue();
				await finishAll(queue);
				const replayedRequest = await attempts(queue, generation.workflowRun.id, requestStep);
				expect(replayedRequest).toEqual(savedRequest);
				expect(globalThis.fetch).toHaveBeenCalledTimes(1);
				const row = await findAppointment(db, appointmentId);
				expect(row).toMatchObject({ video_chat: roomUri, ics_sequence: 1, calendar_revision: 1 });
				expect(send).toHaveBeenCalledTimes(2);
			} finally {
				await queue.close();
			}
		}
	);

	test('a transient suppressed-removal failure stays dirty across restart until native retry cleans before content sync', async () => {
		await db
			.updateTable('appointments')
			.set({
				video_chat: null,
				video_chat_request: 'suppress',
				calendar_revision: 2,
				calendar_synced_revision: 0
			})
			.execute();
		conference = 'ready';
		vi.mocked(patchGoogleEvent).mockRejectedValueOnce(new Error('Google PATCH HTTP 503'));
		let queue = openQueue();
		try {
			await queue.client.runWorkflow(reconcileAppointment, {
				appointmentId,
				emailKind: 'edited-by-host'
			});
			await driveUntil(queue, async () => {
				const workflowRuns = await runs(queue);
				const [generator] = workflowRuns.filter(
					(run) => run.workflowName === generateVideoChat.name
				);
				expect(generator).toMatchObject({ status: 'pending', workerId: null });
				const cleanup = await attempts(queue, generator.id, 'reconcile-video-removal');
				expect(cleanup.map((attempt) => attempt.status)).toEqual(['failed']);
			});
			const before = await findAppointment(db, appointmentId);
			expect(before).toMatchObject({ calendar_revision: 2, calendar_synced_revision: 0 });
			expect(pushAppointment).not.toHaveBeenCalled();
			const workflowRuns = await runs(queue);
			const [generator] = workflowRuns.filter((run) => run.workflowName === generateVideoChat.name);
			const savedPreparation = await attempts(queue, generator.id, 'prepare-video-chat');
			await queue.close();
			queue = openQueue();
			await finishAll(queue);
			const cleanup = await attempts(queue, generator.id, 'reconcile-video-removal');
			expect(cleanup.map((attempt) => attempt.status)).toEqual(['failed', 'completed']);
			const replayedPreparation = await attempts(queue, generator.id, 'prepare-video-chat');
			expect(replayedPreparation).toEqual(savedPreparation);
			const repaired = await findAppointment(db, appointmentId);
			expect(repaired).toMatchObject({
				video_chat: null,
				calendar_revision: 2,
				calendar_synced_revision: 2
			});
			expect(conference).toBe('absent');
			expect(patchGoogleEvent).toHaveBeenCalledTimes(2);
			expect(pushAppointment).toHaveBeenCalledTimes(1);
			expect(vi.mocked(patchGoogleEvent).mock.invocationCallOrder[1]).toBeLessThan(
				vi.mocked(pushAppointment).mock.invocationCallOrder[0]
			);
			expect(send).toHaveBeenCalledTimes(2);
		} finally {
			await queue.close();
		}
	});

	test.each([
		{ name: 'suppressed Google removal PATCH 503', failRead: false },
		{ name: 'old-URL Google GET 503 after video config removal', failRead: true }
	])(
		'$name preserves dirty evidence without blocking mail, then maintenance repairs it after recovery',
		async ({ failRead }) => {
			await db
				.updateTable('appointments')
				.set({
					video_chat: null,
					video_chat_request: 'suppress',
					calendar_revision: 2,
					calendar_synced_revision: 0,
					ics_sequence: 2
				})
				.execute();
			conference = 'ready';
			if (failRead) {
				delete config.meetings['30-min'].video_chat;
				vi.mocked(getGoogleEvent).mockRejectedValue(new Error('Google GET HTTP 503'));
			} else {
				vi.mocked(patchGoogleEvent).mockRejectedValue(new Error('Google PATCH HTTP 503'));
			}
			let queue = openQueue();
			try {
				const parent = await queue.client.runWorkflow(reconcileAppointment, {
					appointmentId,
					emailKind: 'edited-by-host',
					cleanupVideoChatUrl: failRead ? uri : undefined
				});
				await driveUntil(queue, async () => {
					const currentRuns = await runs(queue);
					expect(
						currentRuns.filter((run) => run.workflowName === deliverAppointmentEmail.name)
					).toHaveLength(2);
				});
				const initialRuns = await runs(queue);
				const [generator] = initialRuns.filter(
					(run) => run.workflowName === generateVideoChat.name
				);
				expect(generator).toMatchObject({
					status: 'pending',
					input: { appointmentId, notificationKind: null }
				});
				const preparedDeliveries = initialRuns.filter(
					(run) => run.workflowName === deliverAppointmentEmail.name
				);
				expect(preparedDeliveries).toHaveLength(2);
				expect(JSON.stringify(preparedDeliveries.map((run) => run.input))).not.toContain(uri);
				const beforeCleanup = await findAppointment(db, appointmentId);
				expect(beforeCleanup).toMatchObject({ calendar_revision: 2, calendar_synced_revision: 0 });
				expect(pushAppointment).not.toHaveBeenCalled();
				if (failRead) {
					const oldCleanup = await attempts(queue, parent.workflowRun.id, 'cleanup-video-chat');
					expect(oldCleanup.map((attempt) => attempt.status)).toEqual(['completed']);
					expect(getGoogleEvent).toHaveBeenCalledTimes(2);
				}
				await driveUntil(queue, async () => {
					const parentRun = await queue.backend.getWorkflowRun({
						workflowRunId: parent.workflowRun.id
					});
					const generatorRun = await queue.backend.getWorkflowRun({ workflowRunId: generator.id });
					expect(parentRun).toMatchObject({ status: 'completed', output: 'reconciled' });
					expect(generatorRun).toMatchObject({ status: 'failed' });
				});
				const failedCleanup = await attempts(queue, generator.id, 'reconcile-video-removal');
				expect(failedCleanup.map((attempt) => attempt.status)).toEqual(Array(10).fill('failed'));
				const completedRuns = await runs(queue);
				const deliveries = completedRuns.filter(
					(run) => run.workflowName === deliverAppointmentEmail.name
				);
				expect(deliveries.map((run) => run.output)).toEqual(['sent', 'sent']);
				expect(send).toHaveBeenCalledTimes(2);
				expect(pushAppointment).not.toHaveBeenCalled();
				await queue.close();
				queue = openQueue();
				const ticked = await tickAndSettle(queue);
				expect(ticked).toBe(0);
				const persisted = await findAppointment(db, appointmentId);
				expect(persisted).toMatchObject({
					video_chat: null,
					video_chat_request: 'suppress',
					calendar_revision: 2,
					calendar_synced_revision: 0
				});

				await db
					.insertInto('appointments')
					.values({
						...sampleAppointment,
						id: 'other-dirty-appointment',
						cancel_token: 'other-dirty-token',
						status: 'pending',
						start_time: '2026-01-06T15:00:00Z',
						end_time: '2026-01-06T15:30:00Z',
						calendar_revision: 1,
						calendar_synced_revision: 0
					})
					.execute();
				const ctx = getWorkerContext();
				const readsBeforeMaintenance = vi.mocked(getGoogleEvent).mock.calls.length;
				await scanOnce(ctx);
				expect(getGoogleEvent).toHaveBeenCalledTimes(readsBeforeMaintenance + 1);
				const stillDirty = await findAppointment(db, appointmentId);
				expect(stillDirty).toMatchObject({ calendar_revision: 2, calendar_synced_revision: 0 });
				const other = await findAppointment(db, 'other-dirty-appointment');
				expect(other).toMatchObject({ calendar_revision: 1, calendar_synced_revision: 1 });
				expect(pushAppointment).not.toHaveBeenCalled();

				vi.mocked(getGoogleEvent).mockImplementation(async () => event());
				vi.mocked(patchGoogleEvent).mockImplementation(async () => {
					conference = 'absent';
					return event();
				});
				await scanOnce(ctx);
				const repaired = await findAppointment(db, appointmentId);
				expect(repaired).toMatchObject({
					video_chat: null,
					video_chat_request: 'suppress',
					calendar_revision: 2,
					calendar_synced_revision: 2,
					ics_sequence: 2
				});
				expect(conference).toBe('absent');
				expect(pushAppointment).toHaveBeenCalledTimes(1);
				const patchCalls = vi.mocked(patchGoogleEvent).mock;
				expect(patchCalls.calls.at(-1)).toEqual([
					expect.anything(),
					reference.eventId,
					{ conferenceData: null },
					{ conferenceDataVersion: '1', sendUpdates: 'none' },
					undefined
				]);
				expect(patchCalls.invocationCallOrder.at(-1)).toBeLessThan(
					vi.mocked(pushAppointment).mock.invocationCallOrder[0]
				);
				const savedFailure = await attempts(queue, generator.id, 'reconcile-video-removal');
				expect(savedFailure).toEqual(failedCleanup);
				expect(send).toHaveBeenCalledTimes(2);
				expect(globalThis.fetch).not.toHaveBeenCalled();
			} finally {
				await queue.close();
			}
		}
	);

	test('an already-deleted created Google booking completes through strict DELETE 404 without a conference GET', async () => {
		await db
			.updateTable('appointments')
			.set({ external_calendar_id: null, external_event_id: null })
			.execute();
		let queue = openQueue(async (name) => {
			if (name === 'publish-video-chat') throw new Error('publication interrupted');
		});
		try {
			const generation = await queue.client.runWorkflow(generateVideoChat, {
				appointmentId,
				notificationKind: 'video-chat-added'
			});
			await tickAndSettle(queue);
			const savedBooking = await attempts(queue, generation.workflowRun.id, 'book-google-event');
			expect(savedBooking[0]).toMatchObject({
				status: 'completed',
				output: { reference, created: true }
			});
			const savedRequest = await attempts(queue, generation.workflowRun.id, 'request-video-chat');
			expect(savedRequest[0]).toMatchObject({
				status: 'completed',
				output: {
					status: 'ready',
					url: uri,
					target: { resource: { calendarEvent: reference } }
				}
			});
			expect(deleteAppointmentFromCalendar).not.toHaveBeenCalled();
			await queue.close();
			await db.deleteFrom('appointments').execute();
			vi.mocked(getGoogleEvent).mockClear().mockRejectedValue(new Error('Google GET HTTP 404'));
			vi.mocked(patchGoogleEvent).mockClear();
			const actualCalendar =
				await vi.importActual<typeof import('@when/calendar')>('@when/calendar');
			vi.mocked(deleteAppointmentFromCalendar).mockImplementation(
				actualCalendar.deleteAppointmentFromCalendar
			);
			const deleteUrl = `https://www.googleapis.com/calendar/v3/calendars/remote-calendar/events/${reference.eventId}?sendUpdates=none`;
			vi.mocked(globalThis.fetch).mockImplementation(async (url, options) => {
				if (url === 'https://oauth2.googleapis.com/token' && options?.method === 'POST') {
					return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
				}
				if (url === deleteUrl && options?.method === 'DELETE')
					return new Response(null, { status: 404 });
				throw new Error('Unexpected network call');
			});
			queue = openQueue();
			await finishAll(queue);
			const workflowRuns = await runs(queue);
			expect(workflowRuns).toHaveLength(1);
			expect(workflowRuns[0]).toMatchObject({ status: 'completed', output: { url: null } });
			const replayedRequest = await attempts(
				queue,
				generation.workflowRun.id,
				'request-video-chat'
			);
			expect(replayedRequest).toEqual(savedRequest);
			const bookingCleanup = await attempts(
				queue,
				generation.workflowRun.id,
				'cleanup-unused-booking'
			);
			expect(bookingCleanup).toHaveLength(1);
			expect(bookingCleanup[0]).toMatchObject({ status: 'completed', output: true });
			const conferenceCleanup = await attempts(
				queue,
				generation.workflowRun.id,
				'cleanup-unused-video-chat'
			);
			expect(conferenceCleanup.map((attempt) => attempt.status)).toEqual(['completed']);
			expect(deleteAppointmentFromCalendar).toHaveBeenCalledExactlyOnceWith(
				config,
				reference.calendarId,
				reference.eventId
			);
			const remoteDeletes = vi
				.mocked(globalThis.fetch)
				.mock.calls.filter(([, options]) => options?.method === 'DELETE');
			expect(remoteDeletes).toHaveLength(1);
			expect(remoteDeletes[0][0]).toBe(deleteUrl);
			expect(getGoogleEvent).not.toHaveBeenCalled();
			expect(patchGoogleEvent).not.toHaveBeenCalled();
			expect(pushAppointment).toHaveBeenCalledTimes(1);
			expect(send).not.toHaveBeenCalled();
		} finally {
			await queue.close();
		}
	});

	test.each(['purged', 'removed'] as const)(
		'cleans the saved newly-booked Google reference when the source is %s before reference recording',
		async (state) => {
			await db
				.updateTable('appointments')
				.set({ external_calendar_id: null, external_event_id: null })
				.execute();
			let queue = openQueue(async (name) => {
				if (name === 'record-booking-reference') throw new Error('reference recording interrupted');
			});
			try {
				const generation = await queue.client.runWorkflow(generateVideoChat, {
					appointmentId,
					notificationKind: 'video-chat-added'
				});
				await tickAndSettle(queue);
				const savedBooking = await attempts(queue, generation.workflowRun.id, 'book-google-event');
				expect(savedBooking).toHaveLength(1);
				expect(savedBooking[0]).toMatchObject({
					status: 'completed',
					output: { reference, created: true }
				});
				expect(pushAppointment).toHaveBeenCalledTimes(1);
				expect(deleteAppointmentFromCalendar).not.toHaveBeenCalled();
				await queue.close();
				if (state === 'purged')
					await db.updateTable('appointments').set({ status: 'purged' }).execute();
				else await db.deleteFrom('appointments').execute();
				queue = openQueue();
				await finishAll(queue);
				const replayedBooking = await attempts(
					queue,
					generation.workflowRun.id,
					'book-google-event'
				);
				expect(replayedBooking).toEqual(savedBooking);
				expect(pushAppointment).toHaveBeenCalledTimes(1);
				expect(deleteAppointmentFromCalendar).toHaveBeenCalledExactlyOnceWith(
					config,
					reference.calendarId,
					reference.eventId
				);
				expect(patchGoogleEvent).not.toHaveBeenCalled();
				expect(send).not.toHaveBeenCalled();
				const workflowRuns = await runs(queue);
				expect(workflowRuns).toHaveLength(1);
				expect(workflowRuns[0]).toMatchObject({ status: 'completed', output: { url: null } });
			} finally {
				await queue.close();
			}
		}
	);
	test.each(['same-pair', 'different-calendar'] as const)(
		'newly booked source-gone cleanup protects only an active exact pair: %s',
		async (binding) => {
			await db
				.updateTable('appointments')
				.set({ external_calendar_id: null, external_event_id: null })
				.execute();
			let queue = openQueue(async (name) => {
				if (name === 'record-booking-reference') throw new Error('reference recording interrupted');
			});
			try {
				const generation = await queue.client.runWorkflow(generateVideoChat, {
					appointmentId,
					notificationKind: 'video-chat-added'
				});
				await tickAndSettle(queue);
				const booking = await attempts(queue, generation.workflowRun.id, 'book-google-event');
				expect(booking[0]).toMatchObject({
					status: 'completed',
					output: { reference, created: true }
				});
				await queue.close();
				await db.deleteFrom('appointments').execute();
				await db
					.insertInto('appointments')
					.values({
						...sampleAppointment,
						id: 'protector',
						cancel_token: 'protector-token',
						external_event_id: reference.eventId,
						external_calendar_id: binding === 'same-pair' ? reference.calendarId : 'other-calendar'
					})
					.execute();
				queue = openQueue();
				await finishAll(queue);
				expect(deleteAppointmentFromCalendar).toHaveBeenCalledTimes(
					binding === 'same-pair' ? 0 : 1
				);
				if (binding === 'different-calendar')
					expect(deleteAppointmentFromCalendar).toHaveBeenCalledWith(
						config,
						reference.calendarId,
						reference.eventId
					);
				expect(patchGoogleEvent).not.toHaveBeenCalled();
				expect(send).not.toHaveBeenCalled();
			} finally {
				await queue.close();
			}
		}
	);
});
