import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, parseActionLog, runMigrations, type Appointment } from '@when/db';
import type { AppointmentEmailKind } from '@when/jobs';
import type { RetryPolicy } from 'openworkflow';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';
import type { Envelope } from '../email/recipients.js';
import type { SendResult } from '../email/smtp.js';
import * as dispatch from '../email/dispatch.js';
import { setWorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import {
	deliverAppointmentEmail,
	runDeliverAppointmentEmail,
	type DeliverAppointmentEmailInput
} from './deliver-appointment-email.js';
import { notifyAppointment, runNotifyAppointment } from './notify-appointment.js';

const at = '2026-02-01T12:00:00.000Z';
const clock = { now: () => new Date(at) };
const uri = 'https://video.example.test/call/saved';
const input = { appointmentId: sampleAppointment.id, kind: 'confirmed' } as const;

type StepConfig = { name: string; retryPolicy?: Partial<RetryPolicy> };
let db: ReturnType<typeof openDb>;
let send: ReturnType<typeof vi.fn<(envelope: Envelope) => Promise<SendResult>>>;

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
	await db
		.insertInto('appointments')
		.values({ ...sampleAppointment, video_chat: uri })
		.execute();
	send = vi.fn(async () => ({ ok: true }));
	setWorkerContext({ db, config: sampleConfig, logger: createLogger(), mailer: { send } });
	vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network call'));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await db.destroy();
});

// Successful callbacks are serialized and reused; failures escape to native retries.
function nativeStep() {
	const saved = new Map<string, unknown>();
	const names: string[] = [];
	const childCalls: { input: DeliverAppointmentEmailInput; name: string }[] = [];
	const childConfigs: { name: string; config: StepConfig }[] = [];
	const children: Promise<unknown>[] = [];
	const step: Parameters<typeof runNotifyAppointment>[1] = {
		async run<T>({ name }: { name: string }, fn: () => Promise<T> | T): Promise<T> {
			names.push(name);
			if (saved.has(name)) return structuredClone(saved.get(name)) as T;
			const result = await fn();
			saved.set(name, structuredClone(result));
			return result;
		},
		runWorkflow(spec, childInput, { name }) {
			expect(spec).toBe(deliverAppointmentEmail);
			childCalls.push({ input: structuredClone(childInput), name });
			const child = runDeliverAppointmentEmail(
				childInput,
				{
					async run<T>(config: StepConfig, fn: () => Promise<T> | T): Promise<T> {
						childConfigs.push({ name, config });
						const key = `${name}:${config.name}`;
						if (saved.has(key)) return structuredClone(saved.get(key)) as T;
						const result = await fn();
						saved.set(key, structuredClone(result));
						return result;
					}
				},
				clock
			);
			children.push(child);
			return child;
		}
	};
	return { step, names, childCalls, childConfigs, children };
}

async function emailStates() {
	const row = await db.selectFrom('appointments').select('action_log').executeTakeFirstOrThrow();
	return parseActionLog(row.action_log)
		.filter((entry) => entry.action === 'email')
		.map((entry) => entry.payload?.metadata?.state);
}

describe('notify appointment', () => {
	test('returns the confirmed snapshot URI only after both native children accept SMTP', async () => {
		const f = nativeStep();
		const guest = Promise.withResolvers<SendResult>();
		const host = Promise.withResolvers<SendResult>();
		send.mockImplementation((envelope) =>
			envelope.to === sampleAppointment.guest_email ? guest.promise : host.promise
		);
		let settled = false;
		const run = runNotifyAppointment(input, f.step, clock).then((result) => {
			settled = true;
			return result;
		});
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
		expect(notifyAppointment.name).toBe('notify-appointment');
		expect(settled).toBe(false);
		guest.resolve({ ok: true });
		await vi.waitFor(() =>
			expect(f.childConfigs).toContainEqual({
				name: 'email:guest',
				config: { name: 'smtp:status' }
			})
		);
		const beforeHost = await emailStates();
		expect(beforeHost).toEqual([]);
		expect(settled).toBe(false);
		host.resolve({ ok: true });
		const result = await run;
		expect(result).toEqual({ videoChatUrl: uri });
		expect(f.names).toEqual(['prepare-emails', 'log:result']);
		expect(f.childCalls.map(({ input: child, name }) => [child.role, name])).toEqual([
			['guest', 'email:guest'],
			['host', 'email:host']
		]);
		for (const { input: child } of f.childCalls) {
			expect(child).toMatchObject({ appointmentId: input.appointmentId, kind: 'confirmed' });
			expect(child.envelope.text).toContain(uri);
		}
		expect(f.childCalls[0].input.envelope.attachments?.[0].content).toContain(uri);
		for (const name of ['email:guest', 'email:host']) {
			expect(
				f.childConfigs.filter((entry) => entry.name === name).map(({ config }) => config)
			).toEqual([
				{
					name: 'smtp',
					retryPolicy: {
						maximumAttempts: 5,
						initialInterval: '30s',
						backoffCoefficient: 2,
						maximumInterval: '10m'
					}
				},
				{ name: 'smtp:status' }
			]);
		}
		const states = await emailStates();
		expect(states).toEqual(['done']);
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	test('pending link-added mail hides the URI from the guest but receipts the host snapshot', async () => {
		await db.updateTable('appointments').set({ status: 'pending' }).execute();
		const f = nativeStep();
		const result = await runNotifyAppointment(
			{ ...input, kind: 'video-chat-added', videoChatUrl: uri },
			f.step,
			clock
		);
		expect(result).toEqual({ videoChatUrl: uri });
		expect(f.childCalls.map(({ input: child }) => child.role)).toEqual(['host']);
		expect(send).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				to: sampleConfig.user.email,
				text: expect.stringContaining(uri)
			})
		);
	});

	test('a booking with no saved link receipts null URI, not a skipped notification', async () => {
		await db.updateTable('appointments').set({ video_chat: null }).execute();
		const f = nativeStep();
		const result = await runNotifyAppointment(input, f.step, clock);
		expect(result).toEqual({ videoChatUrl: null });
		expect(send).toHaveBeenCalledTimes(2);
	});

	test.each(['missing', 'purged'] as const)('skips a %s appointment', async (state) => {
		if (state === 'missing') await db.deleteFrom('appointments').execute();
		else await db.updateTable('appointments').set({ status: 'purged' }).execute();
		const f = nativeStep();
		const result = await runNotifyAppointment(input, f.step, clock);
		expect(result).toBeNull();
		expect(f.childCalls).toEqual([]);
		expect(f.names).toEqual(['prepare-emails']);
		expect(send).not.toHaveBeenCalled();
	});

	test.each<{
		kind: AppointmentEmailKind;
		status: Appointment['status'];
		video_chat: string | null;
	}>([
		{ kind: 'pending', status: 'confirmed', video_chat: uri },
		{ kind: 'pending', status: 'cancelled', video_chat: uri },
		{ kind: 'confirmed', status: 'pending', video_chat: uri },
		{ kind: 'confirmed', status: 'cancelled', video_chat: uri },
		{ kind: 'video-chat-added', status: 'cancelled', video_chat: uri },
		{ kind: 'video-chat-added', status: 'confirmed', video_chat: null },
		{ kind: 'video-chat-added', status: 'pending', video_chat: null }
	])(
		'skips obsolete $kind mail for $status / $video_chat',
		async ({ kind, status, video_chat }) => {
			await db.updateTable('appointments').set({ status, video_chat }).execute();
			const f = nativeStep();
			const notification =
				kind === 'video-chat-added' ? { ...input, kind, videoChatUrl: uri } : { ...input, kind };
			const result = await runNotifyAppointment(notification, f.step, clock);
			expect(result).toBeNull();
			expect(f.childCalls).toEqual([]);
			const states = await emailStates();
			expect(states).toEqual([]);
		}
	);

	test.each<{
		status: 'pending' | 'confirmed';
		video_chat: string;
		video_chat_request: Appointment['video_chat_request'];
	}>([
		{
			status: 'confirmed',
			video_chat: 'https://video.example.test/custom',
			video_chat_request: null
		},
		{
			status: 'pending',
			video_chat: 'https://video.example.test/custom',
			video_chat_request: null
		},
		{ status: 'confirmed', video_chat: uri, video_chat_request: 'suppress' },
		{ status: 'pending', video_chat: uri, video_chat_request: 'suppress' }
	])(
		'skips stale link-added handoffs for $status / $video_chat / $video_chat_request',
		async (current) => {
			await db.updateTable('appointments').set(current).execute();
			const prepare = vi.spyOn(dispatch, 'prepareAppointmentEmails');
			const f = nativeStep();
			const result = await runNotifyAppointment(
				{ ...input, kind: 'video-chat-added', videoChatUrl: uri },
				f.step,
				clock
			);
			expect(result).toBeNull();
			expect(prepare).not.toHaveBeenCalled();
			expect(send).not.toHaveBeenCalled();
			expect(f.childCalls).toEqual([]);
			expect(f.names).toEqual(['prepare-emails']);
			const states = await emailStates();
			expect(states).toEqual([]);
		}
	);

	test('prepared link-added mail survives replacement and suppression after a child accepted SMTP', async () => {
		const prepare = vi.spyOn(dispatch, 'prepareAppointmentEmails');
		const f = nativeStep();
		const notification = { ...input, kind: 'video-chat-added', videoChatUrl: uri } as const;
		send.mockImplementation(async (envelope) =>
			envelope.to === sampleAppointment.guest_email
				? { ok: false, reason: 'guest SMTP down' }
				: { ok: true }
		);
		const first = runNotifyAppointment(notification, f.step, clock);
		await expect(first).rejects.toThrow('guest SMTP down');
		await Promise.allSettled(f.children);
		expect(f.childConfigs).toContainEqual({ name: 'email:host', config: { name: 'smtp:status' } });
		expect(f.names).not.toContain('log:result');
		const original = structuredClone(f.childCalls);
		await db
			.updateTable('appointments')
			.set({
				video_chat: 'https://video.example.test/custom',
				video_chat_request: 'suppress'
			})
			.execute();
		send.mockResolvedValue({ ok: true });
		const result = await runNotifyAppointment(notification, f.step, clock);
		expect(result).toEqual({ videoChatUrl: uri });
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(f.childCalls.slice(2)).toEqual(original);
		expect(send).toHaveBeenCalledTimes(3);
		expect(send.mock.calls[2][0]).toEqual(original[0].input.envelope);
		expect(send.mock.calls[2][0].text).toContain(uri);
		const states = await emailStates();
		expect(states).toEqual(['failed', 'done']);
	});

	test('leaves other kinds to the existing builder policy', async () => {
		await db.updateTable('appointments').set({ status: 'pending' }).execute();
		const f = nativeStep();
		const result = await runNotifyAppointment({ ...input, kind: 'edited-by-host' }, f.step, clock);
		expect(result).toEqual({ videoChatUrl: uri });
		expect(f.childCalls.map(({ input: child }) => child.role)).toEqual(['host']);
	});

	test('SMTP failure escapes; replay reuses prepared envelopes and URI despite a changed row', async () => {
		const prepare = vi.spyOn(dispatch, 'prepareAppointmentEmails');
		const f = nativeStep();
		send.mockResolvedValue({ ok: false, reason: 'SMTP down' });
		const first = runNotifyAppointment(input, f.step, clock);
		await expect(first).rejects.toThrow('SMTP down');
		await Promise.allSettled(f.children);
		const failedStates = await emailStates();
		expect(failedStates).toEqual(['failed', 'failed']);
		expect(f.names).not.toContain('log:result');
		const original = structuredClone(f.childCalls);
		await db
			.updateTable('appointments')
			.set({ video_chat: 'https://video.example.test/replaced', guest_email: 'new@example.test' })
			.execute();
		send.mockResolvedValue({ ok: true });
		const result = await runNotifyAppointment(input, f.step, clock);
		expect(result).toEqual({ videoChatUrl: uri });
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(f.childCalls.slice(2)).toEqual(original);
		const states = await emailStates();
		expect(states).toEqual(['failed', 'failed', 'done']);
	});

	test('same-address guest and host keep independent child checkpoints', async () => {
		await db.updateTable('appointments').set({ guest_email: sampleConfig.user.email }).execute();
		const f = nativeStep();
		send
			.mockResolvedValueOnce({ ok: false, reason: 'guest failed' })
			.mockResolvedValue({ ok: true });
		const first = runNotifyAppointment(input, f.step, clock);
		await expect(first).rejects.toThrow('guest failed');
		await Promise.allSettled(f.children);
		expect(f.names).not.toContain('log:result');
		const result = await runNotifyAppointment(input, f.step, clock);
		expect(result).toEqual({ videoChatUrl: uri });
		expect(send).toHaveBeenCalledTimes(3);
		expect(send.mock.calls.map(([envelope]) => envelope.to)).toEqual(
			Array(3).fill(sampleConfig.user.email)
		);
		expect(send.mock.calls[2][0]).toEqual(f.childCalls[0].input.envelope);
		const states = await emailStates();
		expect(states).toEqual(['failed', 'done']);
	});

	test('a purge between preparation and SMTP yields no receipt or done log', async () => {
		const f = nativeStep();
		const step: Parameters<typeof runNotifyAppointment>[1] = {
			...f.step,
			async runWorkflow(spec, child, options) {
				await db.updateTable('appointments').set({ status: 'purged' }).execute();
				const result = await f.step.runWorkflow(spec, child, options);
				return result;
			}
		};
		const result = await runNotifyAppointment(input, step, clock);
		expect(result).toBeNull();
		expect(send).not.toHaveBeenCalled();
		expect(f.names).not.toContain('log:result');
		const states = await emailStates();
		expect(states).toEqual([]);
	});
});
