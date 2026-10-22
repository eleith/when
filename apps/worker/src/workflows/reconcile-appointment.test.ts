import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations } from '@when/db';
import { generateVideoChat } from '@when/jobs';
import { videoChatGenerationKey } from '@when/jobs/specs';
import { setWorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';
import { runReconcileAppointment } from './reconcile-appointment.js';
import { notifyAppointment } from './notify-appointment.js';
import type { WhenConfiguration } from '@when/config';

const queued = vi.hoisted(() => vi.fn());
vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return { ...actual, getOpenWorkflow: () => ({ runWorkflow: queued }) };
});

async function fixture() {
	const db = openDb(':memory:');
	await runMigrations(db);
	await db
		.insertInto('appointments')
		.values({ ...sampleAppointment, status: 'confirmed', video_chat: null })
		.execute();
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
	const send = vi.fn();
	setWorkerContext({ db, config, logger: createLogger(), mailer: { send } });
	const notify = vi.fn().mockResolvedValue({ videoChatUrl: null });
	const step: Parameters<typeof runReconcileAppointment>[1] = {
		run: async (_options, fn) => {
			const result = await fn();
			return result;
		},
		runWorkflow: notify
	};
	return { db, config, send, notify, step };
}

beforeEach(() => {
	vi.restoreAllMocks();
	queued.mockReset().mockResolvedValue({ workflowRun: { id: 'video' } });
});

describe('notification ownership during reconciliation', () => {
	test.each(['pending', 'confirmed'] as const)(
		'automatic missing video delegates the full %s notice, never a second independent mail',
		async (kind) => {
			const f = await fixture();
			try {
				await f.db.updateTable('appointments').set({ status: kind }).execute();
				const network = vi
					.spyOn(globalThis, 'fetch')
					.mockRejectedValue(new Error('must not call video here'));
				const result = await runReconcileAppointment(
					{ appointmentId: sampleAppointment.id, emailKind: kind },
					f.step
				);
				expect(result).toBe('reconciled');
				expect(queued).toHaveBeenCalledExactlyOnceWith(
					generateVideoChat,
					{ appointmentId: sampleAppointment.id, notificationKind: kind },
					{
						idempotencyKey: videoChatGenerationKey(
							sampleAppointment.id,
							sampleAppointment.calendar_revision,
							kind
						)
					}
				);
				expect(f.notify).not.toHaveBeenCalled();
				expect(f.send).not.toHaveBeenCalled();
				expect(network).not.toHaveBeenCalled();
			} finally {
				await f.db.destroy();
			}
		}
	);

	test('a normal booking without configured video sends its original notice normally', async () => {
		const f = await fixture();
		try {
			delete f.config.meetings['30-min'].video_chat;
			await runReconcileAppointment(
				{ appointmentId: sampleAppointment.id, emailKind: 'confirmed' },
				f.step
			);
			expect(queued).not.toHaveBeenCalled();
			expect(f.notify).toHaveBeenCalledExactlyOnceWith(
				notifyAppointment,
				{ appointmentId: sampleAppointment.id, kind: 'confirmed' },
				{ name: 'notify-appointment' }
			);
		} finally {
			await f.db.destroy();
		}
	});

	test('a nonmatching phone answer follows the normal booking path', async () => {
		const f = await fixture();
		try {
			f.config.meetings['30-min'].video_chat!.attach = {
				when: [{ field: 'meeting_type', equals: 'video chat' }]
			};
			await f.db
				.updateTable('appointments')
				.set({
					guest_answers: JSON.stringify([
						{ name: 'meeting_type', label: 'How?', type: 'choice', value: 'by phone' }
					])
				})
				.execute();
			await runReconcileAppointment(
				{ appointmentId: sampleAppointment.id, emailKind: 'confirmed' },
				f.step
			);
			expect(queued).not.toHaveBeenCalled();
			expect(f.notify).toHaveBeenCalledOnce();
		} finally {
			await f.db.destroy();
		}
	});

	test('a saved link uses normal notification without generation', async () => {
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
			expect(f.notify).toHaveBeenCalledOnce();
		} finally {
			await f.db.destroy();
		}
	});

	test('suppression keeps the original notice normal and requests cleanup without another notification', async () => {
		const f = await fixture();
		try {
			await f.db
				.updateTable('appointments')
				.set({ video_chat_request: 'suppress', calendar_revision: 4 })
				.execute();
			await runReconcileAppointment(
				{ appointmentId: sampleAppointment.id, emailKind: 'confirmed' },
				f.step
			);
			expect(queued).toHaveBeenCalledExactlyOnceWith(
				generateVideoChat,
				{ appointmentId: sampleAppointment.id, notificationKind: null },
				{ idempotencyKey: videoChatGenerationKey(sampleAppointment.id, 4, null) }
			);
			expect(f.notify).toHaveBeenCalledExactlyOnceWith(
				notifyAppointment,
				{ appointmentId: sampleAppointment.id, kind: 'confirmed' },
				{ name: 'notify-appointment' }
			);
		} finally {
			await f.db.destroy();
		}
	});

	test('manual force on a non-automatic meeting remains an update, not owner of the booking notice', async () => {
		const f = await fixture();
		try {
			f.config.meetings['30-min'].video_chat!.attach = { auto: false };
			await f.db.updateTable('appointments').set({ video_chat_request: 'generate' }).execute();
			await runReconcileAppointment(
				{ appointmentId: sampleAppointment.id, emailKind: 'confirmed' },
				f.step
			);
			expect(queued.mock.calls[0][1]).toEqual({
				appointmentId: sampleAppointment.id,
				notificationKind: 'video-chat-added'
			});
			expect(f.notify.mock.calls[0][1]).toEqual({
				appointmentId: sampleAppointment.id,
				kind: 'confirmed'
			});
		} finally {
			await f.db.destroy();
		}
	});

	test('ordinary edits keep their update notification and request background attachment separately', async () => {
		const f = await fixture();
		try {
			await runReconcileAppointment(
				{ appointmentId: sampleAppointment.id, emailKind: 'edited-by-host' },
				f.step
			);
			expect(queued.mock.calls[0][1]).toEqual({
				appointmentId: sampleAppointment.id,
				notificationKind: 'video-chat-added'
			});
			expect(f.notify.mock.calls[0][1]).toEqual({
				appointmentId: sampleAppointment.id,
				kind: 'edited-by-host'
			});
		} finally {
			await f.db.destroy();
		}
	});

	test('unselected old rooms are cleaned without clearing the chosen replacement', async () => {
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
			const current = await f.db
				.selectFrom('appointments')
				.select('video_chat')
				.executeTakeFirstOrThrow();
			expect(current.video_chat).toBe('https://cloud.example.com/call/current');
		} finally {
			await f.db.destroy();
		}
	});

	test.each(['purged', 'cancelled'] as const)(
		'does not send a stale confirmed notice after %s',
		async (status) => {
			const f = await fixture();
			try {
				await f.db.updateTable('appointments').set({ status }).execute();
				await runReconcileAppointment(
					{ appointmentId: sampleAppointment.id, emailKind: 'confirmed' },
					f.step
				);
				expect(queued).not.toHaveBeenCalled();
				expect(f.notify).not.toHaveBeenCalled();
			} finally {
				await f.db.destroy();
			}
		}
	);
});
