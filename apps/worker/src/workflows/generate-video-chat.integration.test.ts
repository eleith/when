import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { OpenWorkflow, type Worker } from 'openworkflow';
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
import { runGenerateVideoChat } from './generate-video-chat.js';
import { runReconcileAppointment } from './reconcile-appointment.js';
import {
	deliverAppointmentEmail,
	runDeliverAppointmentEmail,
	type DeliverAppointmentEmailInput
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
let conference: 'absent' | 'pending' | 'ready';
let requestOutcome: 'pending' | 'ready';

function event() {
	if (conference === 'absent') return { id: reference.eventId };
	return {
		id: reference.eventId,
		conferenceData: {
			createRequest: { status: { statusCode: conference === 'ready' ? 'success' : 'pending' } },
			entryPoints: conference === 'ready' ? [{ entryPointType: 'video', uri }] : []
		}
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
					)
			},
			clock
		)
	);
	client.implementWorkflow(reconcileAppointment, ({ input, step }) =>
		runReconcileAppointment(
			input,
			{
				run: (settings, fn) =>
					step.run(
						{
							...settings,
							retryPolicy: { initialInterval: '1ms', maximumInterval: '1ms' }
						},
						fn
					),
				runWorkflow: (...args) => step.runWorkflow(...args)
			},
			clock
		)
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
async function finishAll(queue: Queue) {
	await driveUntil(queue.worker, async () => {
		const workflowRuns = await runs(queue);
		expect(workflowRuns.every((run) => run.status === 'completed')).toBe(true);
	});
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'when-generate-video-'));
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
	test.each(['automatic', 'manual'] as const)(
		'%s ready generation still follows booking mail, edits both sequences once, and saves neutral notification envelopes across restart',
		async (mode) => {
			if (mode === 'manual') {
				config.meetings['30-min'].video_chat!.attach = { auto: false };
				await db.updateTable('appointments').set({ video_chat_request: 'generate' }).execute();
			}
			let queue = openQueue();
			try {
				const booking = await queue.client.runWorkflow(reconcileAppointment, {
					appointmentId,
					emailKind: 'confirmed'
				});
				await queue.worker.tick();
				await queue.worker.stop();
				const initialRuns = await runs(queue);
				const bookingDeliveries = initialRuns.filter(
					(run) => run.workflowName === deliverAppointmentEmail.name
				);
				expect(bookingDeliveries).toHaveLength(2);
				expect(JSON.stringify(bookingDeliveries.map((run) => run.input))).not.toContain(uri);
				expect(patchGoogleEvent).not.toHaveBeenCalled();
				await driveUntil(queue.worker, async () => {
					const workflowRuns = await runs(queue);
					const notificationDeliveries = workflowRuns.filter(
						(run) =>
							run.workflowName === deliverAppointmentEmail.name &&
							(run.input as unknown as DeliverAppointmentEmailInput).kind === 'video-chat-added'
					);
					expect(notificationDeliveries).toHaveLength(2);
					expect(notificationDeliveries.every((run) => run.status === 'pending')).toBe(true);
				});
				const row = await findAppointment(db, appointmentId);
				expect(row).toMatchObject({ video_chat: uri, ics_sequence: 1, calendar_revision: 1 });
				const edits = parseActionLog(row!.action_log).filter((entry) => entry.action === 'edit');
				expect(edits).toHaveLength(1);
				expect(edits[0].actor).toBe(mode === 'manual' ? 'host' : 'system');
				const workflowRuns = await runs(queue);
				const [notification] = workflowRuns.filter(
					(run) => run.idempotencyKey === `${appointmentId}:video-chat-added:1`
				);
				expect(notification).toMatchObject({
					workflowName: reconcileAppointment.name,
					input: { appointmentId, emailKind: 'video-chat-added' }
				});
				const savedDeliveries = workflowRuns.filter(
					(run) =>
						run.workflowName === deliverAppointmentEmail.name &&
						(run.input as unknown as DeliverAppointmentEmailInput).kind === 'video-chat-added'
				);
				const savedEnvelopes = savedDeliveries.map(
					(run) => (run.input as unknown as DeliverAppointmentEmailInput).envelope
				);
				for (const envelope of savedEnvelopes) {
					expect(envelope.subject).toMatch(/^Video link added:/);
					expect(envelope.text).toContain(uri);
					expect(envelope.text).not.toMatch(/approved|confirmed by|host added/i);
				}
				const guest = savedDeliveries.find(
					(run) => (run.input as unknown as DeliverAppointmentEmailInput).role === 'guest'
				);
				const guestEnvelope = (guest!.input as unknown as DeliverAppointmentEmailInput).envelope;
				expect(guestEnvelope.attachments).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ content: expect.stringContaining('SEQUENCE:1') })
					])
				);
				await queue.close();
				await db
					.updateTable('appointments')
					.set({ guest_name: 'Changed guest', guest_email: 'changed@example.com' })
					.execute();
				config.user.email = 'changed-owner@example.com';
				config.meetings['30-min'].title = 'Changed meeting';
				queue = openQueue();
				await finishAll(queue);
				const finalRuns = await runs(queue);
				expect(finalRuns).toHaveLength(7);
				expect(finalRuns.find((run) => run.id === booking.workflowRun.id)).toMatchObject({
					status: 'completed'
				});
				expect(send).toHaveBeenCalledTimes(4);
				expect(send.mock.calls.map(([envelope]) => envelope)).toEqual(
					expect.arrayContaining(savedEnvelopes)
				);
				const finalDeliveries = finalRuns.filter((run) =>
					savedDeliveries.some((saved) => saved.id === run.id)
				);
				expect(finalDeliveries.map((run) => run.input)).toEqual(
					savedDeliveries.map((run) => run.input)
				);
				const current = await findAppointment(db, appointmentId);
				expect(current).toMatchObject({ video_chat: uri, ics_sequence: 1, calendar_revision: 1 });
				expect(patchGoogleEvent).toHaveBeenCalledTimes(1);
				expect(globalThis.fetch).not.toHaveBeenCalled();
			} finally {
				await queue.close();
			}
		}
	);

	test('a checkpointed pending request resumes with GET only after restart, never another conference request or booking POST', async () => {
		requestOutcome = 'pending';
		let queue = openQueue();
		try {
			const generation = await queue.client.runWorkflow(generateVideoChat, { appointmentId });
			await queue.worker.tick();
			await queue.worker.stop();
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

	test('the saved publication keys notification by its committed ICS sequence, even after a later edit and restart', async () => {
		let queue = openQueue(async (name) => {
			if (name === 'publish-video-chat') {
				await db.updateTable('appointments').set({ ics_sequence: 4 }).execute();
			}
			if (name === 'notify-video-chat-added') throw new Error('notification enqueue interrupted');
		});
		try {
			const generation = await queue.client.runWorkflow(generateVideoChat, { appointmentId });
			await queue.worker.tick();
			await queue.worker.stop();
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
				(run) => run.workflowName === reconcileAppointment.name
			);
			expect(notifications).toHaveLength(1);
			expect(notifications[0]).toMatchObject({
				idempotencyKey: `${appointmentId}:video-chat-added:5`
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

	test('a saved standalone ready request never repeats its POST when publication resumes after restart', async () => {
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
			if (name === 'publish-video-chat') throw new Error('publication interrupted');
		});
		try {
			const generation = await queue.client.runWorkflow(generateVideoChat, { appointmentId });
			await queue.worker.tick();
			await queue.worker.stop();
			const savedRequest = await attempts(queue, generation.workflowRun.id, 'request-video-chat');
			expect(savedRequest).toHaveLength(1);
			expect(savedRequest[0]).toMatchObject({
				status: 'completed',
				output: { status: 'ready', url: roomUri }
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
			const replayedRequest = await attempts(
				queue,
				generation.workflowRun.id,
				'request-video-chat'
			);
			expect(replayedRequest).toEqual(savedRequest);
			expect(globalThis.fetch).toHaveBeenCalledTimes(1);
			const row = await findAppointment(db, appointmentId);
			expect(row).toMatchObject({ video_chat: roomUri, ics_sequence: 1, calendar_revision: 1 });
			expect(send).toHaveBeenCalledTimes(2);
		} finally {
			await queue.close();
		}
	});

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
			await driveUntil(queue.worker, async () => {
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
				await queue.worker.tick();
				await queue.worker.stop();
				const initialRuns = await runs(queue);
				const [generator] = initialRuns.filter(
					(run) => run.workflowName === generateVideoChat.name
				);
				expect(generator).toMatchObject({ status: 'pending', input: { appointmentId } });
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
					expect(getGoogleEvent).toHaveBeenCalledTimes(1);
				}
				await driveUntil(queue.worker, async () => {
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
				const ticked = await queue.worker.tick();
				await queue.worker.stop();
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
					{ conferenceDataVersion: '1', sendUpdates: 'none' }
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
			const generation = await queue.client.runWorkflow(generateVideoChat, { appointmentId });
			await queue.worker.tick();
			await queue.worker.stop();
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
				const generation = await queue.client.runWorkflow(generateVideoChat, { appointmentId });
				await queue.worker.tick();
				await queue.worker.stop();
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
});
