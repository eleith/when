import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { findAppointment, openDb, parseActionLog, runMigrations, type Appointment } from '@when/db';
import { getOpenWorkflow, reconcileAppointment } from '@when/jobs';
import { pushAppointment } from '@when/calendar';
import { getVideoChatAdapter, type VideoChatAdapter } from '@when/video-chat';
import type { WhenConfiguration } from '@when/config';
import type { RetryPolicy } from 'openworkflow';
import { setWorkerContext, type WorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';
import { runGenerateVideoChat } from './generate-video-chat.js';

const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return { ...actual, getOpenWorkflow: vi.fn(() => ({ runWorkflow: enqueue })) };
});
vi.mock('@when/video-chat', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/video-chat')>();
	return { ...actual, getVideoChatAdapter: vi.fn() };
});
vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return { ...actual, pushAppointment: vi.fn() };
});

const url = 'https://cloud.example.com/call/generated';
const clock = { now: () => new Date('2026-01-02T10:00:00.000Z') };
const input = { appointmentId: 'a' };
let ctx: WorkerContext;
let adapter: VideoChatAdapter;
const send = vi.fn();

// Direct workflow tests, not a native-engine harness. Only successful step results
// are cached; a lost checkpoint leaves the effect visible but reruns that step.
function cachedSteps() {
	const saved = new Map<string, unknown>();
	const executions: string[] = [];
	const policies = new Map<string, Partial<RetryPolicy> | undefined>();
	let failBefore: string | undefined;
	let failAfter: string | undefined;
	let afterEffect: ((name: string) => Promise<void>) | undefined;
	const step = {
		async run<T>(
			config: { name: string; retryPolicy?: Partial<RetryPolicy> },
			fn: () => Promise<T> | T
		): Promise<T> {
			if (saved.has(config.name)) return structuredClone(saved.get(config.name)) as T;
			if (failBefore === config.name) {
				failBefore = undefined;
				throw new Error(`before ${config.name}`);
			}
			executions.push(config.name);
			policies.set(config.name, config.retryPolicy);
			const result = await fn();
			if (afterEffect) await afterEffect(config.name);
			if (failAfter === config.name) {
				failAfter = undefined;
				throw new Error(`lost checkpoint: ${config.name}`);
			}
			saved.set(config.name, structuredClone(result));
			return result;
		}
	};
	return {
		step,
		saved,
		executions,
		policies,
		loseCheckpointOnce(name: string) {
			failAfter = name;
		},
		interruptBeforeOnce(name: string) {
			failBefore = name;
		},
		afterEffect(fn: (name: string) => Promise<void>) {
			afterEffect = fn;
		}
	};
}

async function seed(patch: Partial<Appointment> = {}) {
	await ctx.db
		.insertInto('appointments')
		.values({
			...sampleAppointment,
			id: 'a',
			event_type_id: 'chat',
			calendar_revision: 4,
			ics_sequence: 7,
			...patch
		})
		.execute();
}

async function row() {
	const current = await findAppointment(ctx.db, 'a');
	if (!current) throw new Error('Missing test appointment');
	return current;
}

beforeEach(async () => {
	vi.resetAllMocks();
	vi.mocked(getOpenWorkflow).mockReturnValue({ runWorkflow: enqueue } as unknown as ReturnType<
		typeof getOpenWorkflow
	>);
	enqueue.mockResolvedValue({ id: 'reconciliation' });
	const db = openDb(':memory:');
	await runMigrations(db);
	const config = {
		...sampleConfig,
		providers: {
			nc: {
				type: 'nextcloud',
				url: 'https://cloud.example.com',
				username: 'u',
				password: 'p',
				calendars: {}
			},
			google: {
				type: 'google',
				client_id: 'id',
				client_secret: 'secret',
				refresh_token: 'token',
				calendars: { work: { id: 'primary' } }
			}
		},
		meetings: {
			chat: {
				title: 'Chat',
				booking_calendar: 'work',
				video_chat: { provider: 'nc', attach: { auto: true } }
			}
		}
	} as unknown as WhenConfiguration;
	ctx = { db, config, mailer: { send }, logger: createLogger() };
	setWorkerContext(ctx);
	adapter = {
		read: vi.fn().mockResolvedValue({ ok: true, status: 'absent' }),
		request: vi.fn().mockResolvedValue({ ok: true, status: 'ready', url }),
		removeLink: vi.fn().mockResolvedValue({ ok: true })
	};
	vi.mocked(getVideoChatAdapter).mockReturnValue(adapter);
	vi.mocked(pushAppointment).mockResolvedValue({
		ok: true,
		externalEventId: 'event',
		externalCalendarId: 'work'
	});
});
afterEach(async () => {
	expect(send).not.toHaveBeenCalled();
	await ctx.db.destroy();
});

describe('runGenerateVideoChat with successful-step replay', () => {
	test.each([
		{ choice: null, automatic: true, actor: 'system' },
		{ choice: 'generate', automatic: false, actor: 'host' }
	] as const)(
		'$choice generation publishes then hands off to existing reconciliation, never SMTP',
		async ({ choice, automatic, actor }) => {
			await seed({ video_chat_request: choice });
			ctx.config.meetings.chat.video_chat!.attach = { auto: automatic };
			const steps = cachedSteps();
			const result = await runGenerateVideoChat(input, steps.step, clock);
			expect(result).toEqual({ url });
			const current = await row();
			expect(current).toMatchObject({
				video_chat: url,
				video_chat_request: choice,
				calendar_revision: 5,
				ics_sequence: 8
			});
			expect(parseActionLog(current.action_log)).toEqual([
				{
					action: 'edit',
					actor,
					at: clock.now().toISOString(),
					payload: { metadata: { changes: ['video_chat_added'] } }
				}
			]);
			expect(enqueue).toHaveBeenCalledExactlyOnceWith(
				reconcileAppointment,
				{ appointmentId: 'a', emailKind: 'video-chat-added' },
				{ idempotencyKey: 'a:video-chat-added:8' }
			);
			expect(steps.executions).toEqual([
				'prepare-video-chat',
				'reconcile-video-removal',
				'book-google-event',
				'conference-request-id',
				'request-video-chat',
				'publish-video-chat',
				'cleanup-unused-video-chat',
				'notify-video-chat-added'
			]);
			expect(adapter.request).toHaveBeenCalledWith({
				name: 'Meeting: Jane Doe',
				requestId: steps.saved.get('conference-request-id')
			});
			expect(adapter.removeLink).not.toHaveBeenCalled();
		}
	);

	test.each([
		{ label: 'existing URL', patch: { video_chat: url }, expected: url },
		{ label: 'suppression', patch: { video_chat_request: 'suppress' }, expected: null }
	] as const)('$label at entry does not generate or notify', async ({ patch, expected }) => {
		await seed(patch);
		const before = await row();
		const result = await runGenerateVideoChat(input, cachedSteps().step, clock);
		const after = await row();
		expect(result).toEqual({ url: expected });
		expect(after).toMatchObject({
			video_chat: before.video_chat,
			video_chat_request: before.video_chat_request,
			ics_sequence: before.ics_sequence,
			calendar_revision: before.calendar_revision
		});
		const edits = parseActionLog(after.action_log).filter((entry) => entry.action === 'edit');
		expect(edits).toEqual([]);
		expect(adapter.request).not.toHaveBeenCalled();
		expect(enqueue).not.toHaveBeenCalled();
	});

	test('missing appointment returns null without creating or notifying', async () => {
		const result = await runGenerateVideoChat(input, cachedSteps().step, clock);
		expect(result).toEqual({ url: null });
		expect(adapter.request).not.toHaveBeenCalled();
		expect(enqueue).not.toHaveBeenCalled();
	});

	test('pending Google without a booked event defers with no link or notification', async () => {
		ctx.config.meetings.chat.video_chat!.provider = 'google';
		await seed({ status: 'pending', external_calendar_id: 'work' });
		const result = await runGenerateVideoChat(input, cachedSteps().step, clock);
		expect(result).toEqual({ url: null });
		expect(pushAppointment).not.toHaveBeenCalled();
		expect(adapter.read).not.toHaveBeenCalled();
		expect(adapter.request).not.toHaveBeenCalled();
		expect(enqueue).not.toHaveBeenCalled();
	});

	test('a lost request checkpoint reuses its separate UUID and observes the existing effect before creating again', async () => {
		await seed();
		const steps = cachedSteps();
		steps.loseCheckpointOnce('request-video-chat');
		const interrupted = runGenerateVideoChat(input, steps.step, clock);
		await expect(interrupted).rejects.toThrow('lost checkpoint: request-video-chat');
		const requestId = steps.saved.get('conference-request-id');
		expect(requestId).toEqual(expect.any(String));
		expect(adapter.request).toHaveBeenCalledExactlyOnceWith({
			name: 'Meeting: Jane Doe',
			requestId
		});
		vi.mocked(adapter.read).mockResolvedValue({ ok: true, status: 'ready', url });
		const result = await runGenerateVideoChat(input, steps.step, clock);
		expect(result).toEqual({ url });
		expect(steps.saved.get('conference-request-id')).toBe(requestId);
		expect(adapter.request).toHaveBeenCalledTimes(1);
		expect(adapter.read).toHaveBeenCalledTimes(2);
	});

	test('pending provider retries only its read step, including absent/failed observations', async () => {
		await seed();
		vi.mocked(adapter.request).mockResolvedValue({ ok: true, status: 'pending' });
		vi.mocked(adapter.read)
			.mockResolvedValueOnce({ ok: true, status: 'absent' })
			.mockResolvedValueOnce({ ok: true, status: 'failed' })
			.mockResolvedValueOnce({ ok: true, status: 'absent' })
			.mockResolvedValueOnce({ ok: true, status: 'ready', url });
		const steps = cachedSteps();
		const first = runGenerateVideoChat(input, steps.step, clock);
		await expect(first).rejects.toThrow('failed');
		const second = runGenerateVideoChat(input, steps.step, clock);
		await expect(second).rejects.toThrow('absent');
		const result = await runGenerateVideoChat(input, steps.step, clock);
		expect(result).toEqual({ url });
		expect(adapter.request).toHaveBeenCalledTimes(1);
		expect(adapter.read).toHaveBeenCalledTimes(4);
		expect(steps.executions.filter((name) => name === 'request-video-chat')).toHaveLength(1);
		expect(steps.policies.get('read-pending-video-chat')).toMatchObject({
			maximumAttempts: 10,
			initialInterval: '30s'
		});
		expect(enqueue).toHaveBeenCalledTimes(1);
	});

	test('provider booking checkpoints before SQL reference recording and is reused after interruption', async () => {
		ctx.config.meetings.chat.video_chat!.provider = 'google';
		await seed();
		vi.mocked(pushAppointment).mockResolvedValue({
			ok: true,
			externalCalendarId: 'work',
			externalEventId: 'event'
		});
		vi.mocked(adapter.read).mockResolvedValue({ ok: true, status: 'ready', url });
		const steps = cachedSteps();
		steps.interruptBeforeOnce('record-booking-reference');
		const interrupted = runGenerateVideoChat(input, steps.step, clock);
		await expect(interrupted).rejects.toThrow('before record-booking-reference');
		const unrecorded = await row();
		expect(unrecorded.external_event_id).toBeNull();
		expect(steps.saved.has('book-google-event')).toBe(true);
		expect(steps.saved.has('conference-request-id')).toBe(false);
		const result = await runGenerateVideoChat(input, steps.step, clock);
		expect(result).toEqual({ url });
		expect(pushAppointment).toHaveBeenCalledTimes(1);
		const current = await row();
		expect(current.external_event_id).toBe('event');
		expect(steps.executions.indexOf('record-booking-reference')).toBeLessThan(
			steps.executions.indexOf('conference-request-id')
		);
		expect(adapter.request).not.toHaveBeenCalled();
	});

	test('SQL commit before a lost publish checkpoint replays without a second edit, then queues handoff', async () => {
		await seed();
		const steps = cachedSteps();
		steps.loseCheckpointOnce('publish-video-chat');
		const interrupted = runGenerateVideoChat(input, steps.step, clock);
		await expect(interrupted).rejects.toThrow('lost checkpoint: publish-video-chat');
		const committed = await row();
		expect(committed).toMatchObject({ video_chat: url, calendar_revision: 5, ics_sequence: 8 });
		expect(enqueue).not.toHaveBeenCalled();
		const result = await runGenerateVideoChat(input, steps.step, clock);
		const replayed = await row();
		expect(result).toEqual({ url });
		expect(replayed).toEqual(committed);
		expect(adapter.request).toHaveBeenCalledTimes(1);
		expect(enqueue).toHaveBeenCalledExactlyOnceWith(
			reconcileAppointment,
			{ appointmentId: 'a', emailKind: 'video-chat-added' },
			{ idempotencyKey: 'a:video-chat-added:8' }
		);
	});

	test('handoff key uses actual materialized ICS, not the sequence observed before provider IO', async () => {
		await seed();
		const steps = cachedSteps();
		steps.afterEffect(async (name) => {
			if (name === 'request-video-chat') {
				await ctx.db
					.updateTable('appointments')
					.set({ ics_sequence: 12 })
					.where('id', '=', 'a')
					.execute();
			}
		});
		await runGenerateVideoChat(input, steps.step, clock);
		const current = await row();
		expect(current.ics_sequence).toBe(13);
		expect(enqueue).toHaveBeenCalledWith(
			reconcileAppointment,
			{ appointmentId: 'a', emailKind: 'video-chat-added' },
			{ idempotencyKey: 'a:video-chat-added:13' }
		);
	});

	test.each(['enqueue failure', 'effect before checkpoint loss'] as const)(
		'%s retries the same handoff key without another provider request or SMTP',
		async (failure) => {
			await seed();
			const steps = cachedSteps();
			if (failure === 'enqueue failure')
				enqueue.mockRejectedValueOnce(new Error('queue unavailable'));
			else steps.loseCheckpointOnce('notify-video-chat-added');
			const interrupted = runGenerateVideoChat(input, steps.step, clock);
			await expect(interrupted).rejects.toThrow(
				failure === 'enqueue failure' ? 'queue unavailable' : 'lost checkpoint'
			);
			const committed = await row();
			expect(committed.video_chat).toBe(url);
			await runGenerateVideoChat(input, steps.step, clock);
			const replayed = await row();
			expect(replayed).toEqual(committed);
			expect(enqueue).toHaveBeenCalledTimes(2);
			expect(enqueue.mock.calls[0]).toEqual(enqueue.mock.calls[1]);
			expect(enqueue.mock.calls[1][2]).toEqual({ idempotencyKey: 'a:video-chat-added:8' });
			expect(adapter.request).toHaveBeenCalledTimes(1);
		}
	);

	test('host suppression during creation is never revived; the unused room is cleaned without notification', async () => {
		await seed();
		vi.mocked(adapter.request).mockImplementation(async () => {
			await ctx.db
				.updateTable('appointments')
				.set({ video_chat_request: 'suppress' })
				.where('id', '=', 'a')
				.execute();
			return { ok: true, status: 'ready', url };
		});
		const result = await runGenerateVideoChat(input, cachedSteps().step, clock);
		const current = await row();
		expect(result).toEqual({ url: null });
		expect(current).toMatchObject({
			video_chat: null,
			video_chat_request: 'suppress',
			calendar_revision: 4,
			ics_sequence: 7
		});
		expect(adapter.removeLink).toHaveBeenCalledExactlyOnceWith(url);
		expect(enqueue).not.toHaveBeenCalled();
	});

	test('a different URI selected after publication wins and prevents a stale handoff', async () => {
		await seed();
		const steps = cachedSteps();
		steps.afterEffect(async (name) => {
			if (name === 'publish-video-chat') {
				await ctx.db
					.updateTable('appointments')
					.set({ video_chat: 'https://chosen.example.com', video_chat_request: 'suppress' })
					.where('id', '=', 'a')
					.execute();
			}
		});
		const result = await runGenerateVideoChat(input, steps.step, clock);
		expect(result).toEqual({ url: 'https://chosen.example.com' });
		expect(enqueue).not.toHaveBeenCalled();
		const current = await row();
		expect(current.video_chat_request).toBe('suppress');
	});
});
