import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { findAppointment, openDb, parseActionLog, runMigrations, type Appointment } from '@when/db';
import type { GenerateVideoChatInput } from '@when/jobs';
import { notifyAppointment, type NotifyAppointmentInput } from './notify-appointment.js';
import { pushAppointment } from '@when/calendar';
import { getVideoChatAdapter, type VideoChatAdapter } from '@when/video-chat';
import type { WhenConfiguration } from '@when/config';
import type { RetryPolicy } from 'openworkflow';
import { setWorkerContext, type WorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';
import { runGenerateVideoChat } from './generate-video-chat.js';

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
const input: GenerateVideoChatInput = { appointmentId: 'a', notificationKind: 'video-chat-added' };
const notify = vi.fn();
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
		},
		async runWorkflow(
			spec: typeof notifyAppointment,
			notice: NotifyAppointmentInput,
			options: { name: string }
		) {
			return step.run(options, () => notify(spec, notice, options));
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
	vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network call'));
	notify.mockImplementation(async (_spec, notice) => {
		const current = await findAppointment(ctx.db, notice.appointmentId);
		return current ? { videoChatUrl: current.video_chat } : null;
	});
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
	expect(globalThis.fetch).not.toHaveBeenCalled();
	vi.restoreAllMocks();
	await ctx.db.destroy();
});

describe('runGenerateVideoChat with successful-step replay', () => {
	test.each([
		{ choice: null, automatic: true, actor: 'system' },
		{ choice: 'generate', automatic: false, actor: 'host' }
	] as const)(
		'$choice generation publishes then awaits the neutral notification child, never direct SMTP',
		async ({ choice, automatic, actor }) => {
			const timeout = vi.spyOn(AbortSignal, 'timeout');
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
			expect(parseActionLog(current.action_log).filter((entry) => entry.action === 'edit')).toEqual(
				[
					{
						action: 'edit',
						actor,
						at: clock.now().toISOString(),
						payload: { metadata: { changes: ['video_chat_added'] } }
					}
				]
			);
			expect(notify).toHaveBeenCalledExactlyOnceWith(
				notifyAppointment,
				{ appointmentId: 'a', kind: 'video-chat-added', videoChatUrl: url },
				{ name: 'video-chat-added-notification' }
			);
			expect(steps.executions).toEqual([
				'prepare-video-chat',
				'conference-request-id',
				'reconcile-video-removal',
				'book-google-event',
				'request-video-chat',
				'publish-video-chat',
				'cleanup-unused-video-chat',
				'sync-video-notification',
				'video-chat-added-notification'
			]);
			expect(timeout).not.toHaveBeenCalled();
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
		expect(notify).not.toHaveBeenCalled();
	});

	test('missing appointment returns null without creating or notifying', async () => {
		const result = await runGenerateVideoChat(input, cachedSteps().step, clock);
		expect(result).toEqual({ url: null });
		expect(adapter.request).not.toHaveBeenCalled();
		expect(notify).not.toHaveBeenCalled();
	});

	test('pending Google without a booked event defers with no link or notification', async () => {
		ctx.config.meetings.chat.video_chat!.provider = 'google';
		await seed({ status: 'pending', external_calendar_id: 'work' });
		const result = await runGenerateVideoChat(input, cachedSteps().step, clock);
		expect(result).toEqual({ url: null });
		expect(pushAppointment).not.toHaveBeenCalled();
		expect(adapter.read).not.toHaveBeenCalled();
		expect(adapter.request).not.toHaveBeenCalled();
		expect(notify).not.toHaveBeenCalled();
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
		expect(notify).toHaveBeenCalledTimes(1);
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
		expect(steps.saved.has('conference-request-id')).toBe(true);
		const result = await runGenerateVideoChat(input, steps.step, clock);
		expect(result).toEqual({ url });
		expect(pushAppointment).toHaveBeenCalledTimes(2);
		const current = await row();
		expect(current.external_event_id).toBe('event');
		expect(steps.executions.indexOf('conference-request-id')).toBeLessThan(
			steps.executions.indexOf('record-booking-reference')
		);
		expect(adapter.request).not.toHaveBeenCalled();
	});

	test('SQL commit before a lost publish checkpoint replays without a second edit, then awaits notification', async () => {
		await seed();
		const steps = cachedSteps();
		steps.loseCheckpointOnce('publish-video-chat');
		const interrupted = runGenerateVideoChat(input, steps.step, clock);
		await expect(interrupted).rejects.toThrow('lost checkpoint: publish-video-chat');
		const committed = await row();
		expect(committed).toMatchObject({ video_chat: url, calendar_revision: 5, ics_sequence: 8 });
		expect(notify).not.toHaveBeenCalled();
		const result = await runGenerateVideoChat(input, steps.step, clock);
		const replayed = await row();
		expect(result).toEqual({ url });
		expect(replayed).toMatchObject({
			video_chat: committed.video_chat,
			calendar_revision: committed.calendar_revision,
			ics_sequence: committed.ics_sequence
		});
		expect(
			parseActionLog(replayed.action_log).filter((entry) => entry.action === 'edit')
		).toHaveLength(1);
		expect(adapter.request).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledExactlyOnceWith(
			notifyAppointment,
			{ appointmentId: 'a', kind: 'video-chat-added', videoChatUrl: url },
			{ name: 'video-chat-added-notification' }
		);
	});

	test('notification sees actual materialized ICS, not the sequence observed before provider IO', async () => {
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
		expect(notify).toHaveBeenCalledWith(
			notifyAppointment,
			{ appointmentId: 'a', kind: 'video-chat-added', videoChatUrl: url },
			{ name: 'video-chat-added-notification' }
		);
	});

	test.each(['child creation failure', 'effect before checkpoint loss'] as const)(
		'%s retries the same notification child without another provider request or SMTP',
		async (failure) => {
			await seed();
			const steps = cachedSteps();
			if (failure === 'child creation failure')
				notify.mockRejectedValueOnce(new Error('queue unavailable'));
			else steps.loseCheckpointOnce('video-chat-added-notification');
			const interrupted = runGenerateVideoChat(input, steps.step, clock);
			await expect(interrupted).rejects.toThrow(
				failure === 'child creation failure' ? 'queue unavailable' : 'lost checkpoint'
			);
			const committed = await row();
			expect(committed.video_chat).toBe(url);
			await runGenerateVideoChat(input, steps.step, clock);
			const replayed = await row();
			expect(replayed).toMatchObject({
				video_chat: committed.video_chat,
				calendar_revision: committed.calendar_revision,
				ics_sequence: committed.ics_sequence
			});
			expect(
				parseActionLog(replayed.action_log).filter((entry) => entry.action === 'edit')
			).toHaveLength(1);
			expect(notify).toHaveBeenCalledTimes(2);
			expect(notify.mock.calls[0]).toEqual(notify.mock.calls[1]);
			expect(notify.mock.calls[1][2]).toEqual({ name: 'video-chat-added-notification' });
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
		expect(notify).not.toHaveBeenCalled();
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
		expect(notify).not.toHaveBeenCalled();
		const current = await row();
		expect(current.video_chat_request).toBe('suppress');
	});
	test('automatic ready first publishes before the full notice and never sends added', async () => {
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		await seed();
		const steps = cachedSteps();
		const result = await runGenerateVideoChat(
			{ ...input, notificationKind: 'confirmed' },
			steps.step,
			clock
		);
		expect(result).toEqual({ url });
		expect(notify).toHaveBeenCalledExactlyOnceWith(
			notifyAppointment,
			{ appointmentId: 'a', kind: 'confirmed' },
			{ name: 'original-notification' }
		);
		expect(steps.policies.get('initial-video-request')).toEqual({ maximumAttempts: 1 });
		expect(timeout).toHaveBeenCalledExactlyOnceWith(5_000);
		const signal = vi.mocked(getVideoChatAdapter).mock.calls[0][2];
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(timeout).toHaveReturnedWith(signal);
		expect(steps.saved.has('book-google-event')).toBe(false);
		expect(steps.executions.indexOf('publish-initial-video')).toBeLessThan(
			steps.executions.indexOf('original-notification')
		);
	});

	test('provider failure is saved data; the full notice precedes the remaining native retry budget', async () => {
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		await seed();
		vi.mocked(adapter.request).mockResolvedValueOnce({ ok: false, reason: 'provider unavailable' });
		const steps = cachedSteps();
		await runGenerateVideoChat({ ...input, notificationKind: 'confirmed' }, steps.step, clock);
		expect(steps.saved.get('initial-video-request')).toEqual({
			ok: false,
			reason: 'provider unavailable'
		});
		expect(timeout).toHaveBeenCalledExactlyOnceWith(5_000);
		const signals = vi.mocked(getVideoChatAdapter).mock.calls.map(([, , signal]) => signal);
		expect(signals).toEqual([expect.any(AbortSignal), undefined]);
		expect(steps.policies.get('request-video-chat')).toEqual({ maximumAttempts: 9 });
		expect(steps.policies.get('book-google-event')).toEqual({ maximumAttempts: 9 });
		expect(steps.executions.indexOf('original-notification')).toBeLessThan(
			steps.executions.indexOf('request-video-chat')
		);
		expect(notify.mock.calls.map(([, notice]) => notice.kind)).toEqual([
			'confirmed',
			'video-chat-added'
		]);
	});

	test('a rejected ready first candidate is cleaned before a fresh target is requested', async () => {
		await seed();
		const freshUrl = 'https://cloud.example.com/call/fresh';
		vi.mocked(adapter.request)
			.mockResolvedValueOnce({ ok: true, status: 'ready', url })
			.mockResolvedValueOnce({ ok: true, status: 'ready', url: freshUrl });
		const steps = cachedSteps();
		steps.afterEffect(async (name) => {
			if (name === 'initial-video-request')
				await ctx.db
					.updateTable('appointments')
					.set({ calendar_revision: 5 })
					.where('id', '=', 'a')
					.execute();
		});
		const result = await runGenerateVideoChat(
			{ ...input, notificationKind: 'confirmed' },
			steps.step,
			clock
		);
		expect(result).toEqual({ url: freshUrl });
		expect(adapter.removeLink).toHaveBeenCalledExactlyOnceWith(url);
		expect(steps.executions.indexOf('cleanup-initial-video')).toBeLessThan(
			steps.executions.indexOf('request-video-chat')
		);
		expect(notify.mock.calls.map(([, notice]) => notice.kind)).toEqual([
			'confirmed',
			'video-chat-added'
		]);
	});

	test.each([null, 'suppress'] as const)(
		'cleanup-only purpose with intent %s never creates or notifies',
		async (choice) => {
			await seed({ video_chat_request: choice });
			const steps = cachedSteps();
			const result = await runGenerateVideoChat(
				{ ...input, notificationKind: null },
				steps.step,
				clock
			);
			expect(result).toEqual({ url: null });
			expect(adapter.request).not.toHaveBeenCalled();
			expect(notify).not.toHaveBeenCalled();
			expect(steps.saved.get('prepare-video-chat')).toBe(false);
		}
	);

	test.each([null, 'https://chosen.example.com'] as const)(
		'full notification remains owed with a current selected URI %s',
		async (selected) => {
			await seed({ video_chat: selected, video_chat_request: 'suppress' });
			await runGenerateVideoChat(
				{ ...input, notificationKind: 'confirmed' },
				cachedSteps().step,
				clock
			);
			expect(adapter.request).not.toHaveBeenCalled();
			expect(notify).toHaveBeenCalledExactlyOnceWith(
				notifyAppointment,
				{ appointmentId: 'a', kind: 'confirmed' },
				{ name: 'original-notification' }
			);
		}
	);

	test('a null original receipt stops before retries or creation', async () => {
		await seed();
		vi.mocked(adapter.request).mockResolvedValue({ ok: true, status: 'pending' });
		notify.mockResolvedValue(null);
		const steps = cachedSteps();
		await runGenerateVideoChat({ ...input, notificationKind: 'pending' }, steps.step, clock);
		expect(steps.saved.has('read-pending-video-chat')).toBe(false);
		expect(steps.saved.has('book-google-event')).toBe(false);
		expect(notify).toHaveBeenCalledTimes(1);
	});
});
