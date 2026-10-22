import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations, parseActionLog } from '@when/db';
import { generateVideoChat } from '@when/jobs';
import { setWorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';
import { runReconcileAppointment } from './reconcile-appointment.js';
import {
	deliverAppointmentEmail,
	runDeliverAppointmentEmail
} from './deliver-appointment-email.js';
import type { WhenConfiguration } from '@when/config';

const queued = vi.hoisted(() => vi.fn());
vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return { ...actual, getOpenWorkflow: () => ({ runWorkflow: queued }) };
});

const config: WhenConfiguration = {
	...sampleConfig,
	providers: {
		cloud: {
			type: 'nextcloud',
			url: 'https://cloud.example.com',
			username: 'user',
			password: 'test',
			calendars: {}
		}
	},
	meetings: {
		'30-min': {
			...sampleConfig.meetings['30-min'],
			booking_calendar: 'unconfigured',
			video_chat: { provider: 'cloud', attach: { auto: true } }
		}
	}
};

async function fixture() {
	const db = openDb(':memory:');
	await runMigrations(db);
	await db
		.insertInto('appointments')
		.values({ ...sampleAppointment, status: 'confirmed', video_chat: null })
		.execute();
	const send = vi.fn().mockResolvedValue({ ok: true });
	setWorkerContext({ db, config, logger: createLogger(), mailer: { send } });
	const names: string[] = [];
	const children: Promise<unknown>[] = [];
	const step: Parameters<typeof runReconcileAppointment>[1] = {
		run: async (options, fn) => {
			names.push(options.name);
			const value = await fn();
			return value;
		},
		runWorkflow: (spec, input, options) => {
			expect(spec).toBe(deliverAppointmentEmail);
			names.push(options.name);
			const child = runDeliverAppointmentEmail(input, {
				run: async (_options, fn) => {
					const result = await fn();
					return result;
				}
			});
			children.push(child);
			return child;
		}
	};
	return { db, send, step, names, children };
}

beforeEach(() => {
	vi.restoreAllMocks();
	queued.mockReset().mockResolvedValue({ workflowRun: { id: 'background-video' } });
});

describe('booking and independent video generation', () => {
	test('prepares booking mail before queueing video, without provider generation or waiting for its result', async () => {
		const f = await fixture();
		try {
			const network = vi
				.spyOn(globalThis, 'fetch')
				.mockRejectedValue(new Error('video provider down'));
			queued.mockResolvedValue({
				result: () => {
					throw new Error('must not wait for video');
				}
			});
			const result = await runReconcileAppointment(
				{ appointmentId: sampleAppointment.id, emailKind: 'confirmed' },
				f.step
			);
			expect(result).toBe('reconciled');
			expect(network).not.toHaveBeenCalled();
			expect(f.send).toHaveBeenCalledTimes(2);
			expect(
				f.send.mock.calls.every(
					([envelope]) => !envelope.text.includes('https://cloud.example.com/call/')
				)
			).toBe(true);
			expect(f.names).toEqual([
				'prepare-reconciliation',
				'sync-calendar',
				'prepare-emails',
				'request-video-chat',
				'email:guest',
				'email:host',
				'log:result'
			]);
			expect(queued).toHaveBeenCalledWith(
				generateVideoChat,
				{ appointmentId: sampleAppointment.id },
				{
					idempotencyKey: `generate-video-chat:${sampleAppointment.id}:${sampleAppointment.calendar_revision}`
				}
			);
		} finally {
			await f.db.destroy();
		}
	});

	test('saved links appear in the booking without queueing another generation', async () => {
		const f = await fixture();
		try {
			await f.db
				.updateTable('appointments')
				.set({ video_chat: 'https://cloud.example.com/call/saved' })
				.execute();
			await runReconcileAppointment(
				{ appointmentId: sampleAppointment.id, emailKind: 'confirmed' },
				f.step
			);
			expect(queued).not.toHaveBeenCalled();
			expect(f.send).toHaveBeenCalledTimes(2);
			expect(
				f.send.mock.calls.every(([envelope]) =>
					envelope.text.includes('https://cloud.example.com/call/saved')
				)
			).toBe(true);
		} finally {
			await f.db.destroy();
		}
	});

	test('SMTP failure does not lose the already-enqueued independent video job', async () => {
		const f = await fixture();
		try {
			f.send.mockResolvedValue({ ok: false, reason: 'smtp down' });
			const run = runReconcileAppointment(
				{ appointmentId: sampleAppointment.id, emailKind: 'confirmed' },
				f.step
			);
			await expect(run).rejects.toThrow('smtp down');
			await Promise.allSettled(f.children);
			expect(queued).toHaveBeenCalledTimes(1);
			expect(f.names).not.toContain('log:result');
			const row = await f.db
				.selectFrom('appointments')
				.select('action_log')
				.executeTakeFirstOrThrow();
			const states = parseActionLog(row.action_log)
				.filter((entry) => entry.action === 'email')
				.map((entry) => entry.payload?.metadata?.state);
			expect(states).toEqual(['failed', 'failed']);
		} finally {
			await f.db.destroy();
		}
	});

	test('email-free reconciliation queues the current standing choice without inventing mail', async () => {
		const f = await fixture();
		try {
			await f.db
				.updateTable('appointments')
				.set({ video_chat_request: 'suppress', calendar_revision: 4 })
				.execute();
			await runReconcileAppointment({ appointmentId: sampleAppointment.id }, f.step);
			expect(f.send).not.toHaveBeenCalled();
			expect(queued).toHaveBeenCalledWith(
				generateVideoChat,
				{ appointmentId: sampleAppointment.id },
				{ idempotencyKey: `generate-video-chat:${sampleAppointment.id}:4` }
			);
		} finally {
			await f.db.destroy();
		}
	});

	test('a note edit can remind an outstanding generation using its current calendar revision', async () => {
		const f = await fixture();
		try {
			await f.db
				.updateTable('appointments')
				.set({ video_chat_request: 'generate', calendar_revision: 7 })
				.execute();
			await runReconcileAppointment(
				{ appointmentId: sampleAppointment.id, emailKind: 'edited-by-host' },
				f.step
			);
			expect(queued).toHaveBeenCalledWith(
				generateVideoChat,
				{ appointmentId: sampleAppointment.id },
				{ idempotencyKey: `generate-video-chat:${sampleAppointment.id}:7` }
			);
		} finally {
			await f.db.destroy();
		}
	});

	test('cleans an unselected old room without clearing the chosen replacement', async () => {
		const f = await fixture();
		try {
			await f.db
				.updateTable('appointments')
				.set({
					video_chat: 'https://cloud.example.com/call/current',
					video_chat_request: 'suppress'
				})
				.execute();
			const network = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(null, { status: 204 }));
			await runReconcileAppointment(
				{
					appointmentId: sampleAppointment.id,
					emailKind: 'edited-by-host',
					cleanupVideoChatUrl: 'https://cloud.example.com/call/old'
				},
				f.step
			);
			expect(network).toHaveBeenCalledWith(
				expect.stringContaining('/room/old'),
				expect.objectContaining({ method: 'DELETE' })
			);
			const row = await f.db
				.selectFrom('appointments')
				.select('video_chat')
				.executeTakeFirstOrThrow();
			expect(row.video_chat).toBe('https://cloud.example.com/call/current');
		} finally {
			await f.db.destroy();
		}
	});

	test.each(['cancelled', 'confirmed'] as const)(
		'skips obsolete link-added mail for %s without a selected link',
		async (status) => {
			const f = await fixture();
			try {
				await f.db
					.updateTable('appointments')
					.set({ status, video_chat: null, video_chat_request: 'suppress' })
					.execute();
				await runReconcileAppointment(
					{ appointmentId: sampleAppointment.id, emailKind: 'video-chat-added' },
					f.step
				);
				expect(f.send).not.toHaveBeenCalled();
			} finally {
				await f.db.destroy();
			}
		}
	);

	test('purged appointments cause neither notifications nor new video work', async () => {
		const f = await fixture();
		try {
			await f.db.updateTable('appointments').set({ status: 'purged' }).execute();
			await runReconcileAppointment(
				{ appointmentId: sampleAppointment.id, emailKind: 'confirmed' },
				f.step
			);
			expect(queued).not.toHaveBeenCalled();
			expect(f.send).not.toHaveBeenCalled();
		} finally {
			await f.db.destroy();
		}
	});
});
