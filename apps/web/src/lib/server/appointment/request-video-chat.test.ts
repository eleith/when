import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { findAppointment, openDb, runMigrations, withWriteTransaction } from '@when/db';
import { generateVideoChat } from '@when/jobs';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import { requestVideoChat } from './request-video-chat';

const { runWorkflow } = vi.hoisted(() => ({ runWorkflow: vi.fn() }));
vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return { ...actual, getOpenWorkflow: () => ({ runWorkflow }) };
});

const cfg = {
	...validConfig,
	meetings: {
		'30-min-chat': {
			...validConfig.meetings['30-min-chat'],
			video_chat: { provider: 'google-service' }
		}
	}
};
const clock = {
	now: () => new Date('2099-01-01T12:00:00Z'),
	nowMs: () => Date.parse('2099-01-01T12:00:00Z')
};
let db: ReturnType<typeof openDb>;

beforeEach(async () => {
	runWorkflow.mockReset();
	db = openDb(':memory:');
	await runMigrations(db);
	await db
		.insertInto('appointments')
		.values({
			id: 'appt-1',
			event_type_id: '30-min-chat',
			start_time: '2099-01-01T15:00:00Z',
			end_time: '2099-01-01T15:30:00Z',
			guest_name: 'Booker',
			guest_email: 'booker@example.com',
			guest_answers: null,
			location: null,
			note: null,
			video_chat: null,
			external_event_id: null,
			external_calendar_id: null,
			status: 'confirmed',
			cancel_token: 'token'
		})
		.execute();
});

afterEach(async () => {
	await db.destroy();
});

describe('requestVideoChat', () => {
	test.each([null, 'suppress'] as const)(
		'commits generate from %s before enqueue, without an edit or ICS change',
		async (choice) => {
			await db
				.updateTable('appointments')
				.set({ video_chat_request: choice, calendar_revision: 4, ics_sequence: 2 })
				.execute();
			const before = await findAppointment(db, 'appt-1');
			const workerResult = vi.fn();
			runWorkflow.mockImplementation(async () => {
				// A new write transaction can start only after the request's commit.
				await withWriteTransaction(db, async (connection) => {
					const committed = await findAppointment(connection, 'appt-1');
					expect(committed).toMatchObject({
						video_chat_request: 'generate',
						calendar_revision: 5,
						ics_sequence: 2,
						action_log: before?.action_log
					});
				});
				return { result: workerResult };
			});

			const result = await requestVideoChat({ db, cfg, clock }, { appointmentId: 'appt-1' });

			expect(result).toEqual({ ok: true, outcome: 'requested' });
			expect(runWorkflow).toHaveBeenCalledWith(
				generateVideoChat,
				{ appointmentId: 'appt-1', notificationKind: 'video-chat-added' },
				{ idempotencyKey: 'generate-video-chat:appt-1:5:video-chat-added' }
			);
			expect(workerResult).not.toHaveBeenCalled();
			const saved = await findAppointment(db, 'appt-1');
			expect(saved).toEqual({
				...before,
				video_chat_request: 'generate',
				calendar_revision: 5,
				updated_at: saved?.updated_at
			});
		}
	);

	test('repeated Generate keeps the choice and revision and uses the same key', async () => {
		const first = await requestVideoChat({ db, cfg, clock }, { appointmentId: 'appt-1' });
		const beforeRepeat = await findAppointment(db, 'appt-1');
		const repeated = await requestVideoChat({ db, cfg, clock }, { appointmentId: 'appt-1' });
		const afterRepeat = await findAppointment(db, 'appt-1');

		expect(first).toEqual({ ok: true, outcome: 'requested' });
		expect(repeated).toEqual(first);
		expect(afterRepeat).toEqual(beforeRepeat);
		expect(runWorkflow).toHaveBeenCalledTimes(2);
		expect(runWorkflow.mock.calls[1]).toEqual(runWorkflow.mock.calls[0]);
	});

	test('enqueue failure keeps the choice; retry does not create a revision or fresh key', async () => {
		runWorkflow.mockRejectedValueOnce(new Error('private provider credential'));

		const failed = await requestVideoChat({ db, cfg, clock }, { appointmentId: 'appt-1' });
		const afterFailure = await findAppointment(db, 'appt-1');
		const retried = await requestVideoChat({ db, cfg, clock }, { appointmentId: 'appt-1' });
		const afterRetry = await findAppointment(db, 'appt-1');

		expect(failed).toEqual({ ok: false, reason: 'enqueue_failed', choiceSaved: true });
		expect(afterFailure).toMatchObject({ video_chat_request: 'generate', calendar_revision: 1 });
		expect(retried).toEqual({ ok: true, outcome: 'requested' });
		expect(afterRetry).toEqual(afterFailure);
		expect(runWorkflow.mock.calls[1]).toEqual(runWorkflow.mock.calls[0]);
	});

	test.each([null, 'suppress', 'generate'] as const)(
		'an existing current link is a labeled no-op, preserving %s',
		async (choice) => {
			const page = await findAppointment(db, 'appt-1');
			await db
				.updateTable('appointments')
				.set({
					video_chat: 'https://current.example/room',
					video_chat_request: choice,
					calendar_revision: 3
				})
				.execute();
			const before = await findAppointment(db, 'appt-1');

			const result = await requestVideoChat({ db, cfg, clock }, { appointmentId: page!.id });
			const after = await findAppointment(db, 'appt-1');

			expect(result).toEqual({ ok: true, outcome: 'already_linked' });
			expect(after).toEqual(before);
			expect(runWorkflow).not.toHaveBeenCalled();
		}
	);

	test.each(['cancelled', 'declined', 'expired', 'rescheduled', 'purged'] as const)(
		'gates the fresh %s state',
		async (status) => {
			const page = await findAppointment(db, 'appt-1');
			await db.updateTable('appointments').set({ status }).execute();
			const before = await findAppointment(db, 'appt-1');

			const result = await requestVideoChat({ db, cfg, clock }, { appointmentId: page!.id });
			const after = await findAppointment(db, 'appt-1');

			expect(result).toEqual({ ok: false, reason: 'gated' });
			expect(after).toEqual(before);
			expect(runWorkflow).not.toHaveBeenCalled();
		}
	);

	test.each(['pending', 'confirmed'] as const)(
		'preserves the existing %s gate without imposing a new time restriction',
		async (status) => {
			await db
				.updateTable('appointments')
				.set({ status, start_time: '2000-01-01T15:00:00Z', end_time: '2000-01-01T15:30:00Z' })
				.execute();

			const result = await requestVideoChat({ db, cfg, clock }, { appointmentId: 'appt-1' });

			expect(result).toEqual({ ok: true, outcome: 'requested' });
		}
	);

	test.each(['unconfigured', 'deleted'] as const)(
		'uses current config for a %s meeting',
		async (kind) => {
			const currentConfig = kind === 'deleted' ? { ...validConfig, meetings: {} } : validConfig;
			const before = await findAppointment(db, 'appt-1');

			const result = await requestVideoChat(
				{ db, cfg: currentConfig, clock },
				{ appointmentId: 'appt-1' }
			);
			const after = await findAppointment(db, 'appt-1');

			expect(result).toEqual({ ok: false, reason: 'not_configured' });
			expect(after).toEqual(before);
			expect(runWorkflow).not.toHaveBeenCalled();
		}
	);

	test('reports a missing appointment without queueing', async () => {
		const result = await requestVideoChat({ db, cfg, clock }, { appointmentId: 'missing' });

		expect(result).toEqual({ ok: false, reason: 'not_found' });
		expect(runWorkflow).not.toHaveBeenCalled();
	});
});
