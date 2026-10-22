import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations } from '@when/db';
import { OpenWorkflow } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import { editAppointment } from '../appointment/edit';
import { systemClock } from '../clock';
import { validConfig } from '../__fixtures__/valid-config';

const { runWorkflow, getOpenWorkflow } = vi.hoisted(() => ({
	runWorkflow: vi.fn(),
	getOpenWorkflow: vi.fn()
}));

vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return { ...actual, getOpenWorkflow };
});

import {
	enqueueAppointmentReconciliation,
	enqueueVideoChatGeneration,
	enqueueCalendarSync,
	enqueuePurgeAppointment
} from './index';
import {
	generateVideoChat,
	reconcileAppointment,
	syncCalendars,
	purgeAppointment
} from '@when/jobs';

beforeEach(() => {
	runWorkflow.mockReset();
	getOpenWorkflow.mockReturnValue({ runWorkflow });
});

async function seed() {
	const db = openDb(':memory:');
	await runMigrations(db);
	await db
		.insertInto('appointments')
		.values({
			id: 'appt-1',
			event_type_id: '30-min',
			start_time: '2099-01-01T15:00:00Z',
			end_time: '2099-01-01T15:30:00Z',
			guest_name: 'Booker',
			guest_email: 'booker@example.com',
			guest_answers: null,
			location: null,
			status: 'confirmed',
			cancel_token: 't1'
		})
		.execute();
	return db;
}

async function fetchRow(db: ReturnType<typeof openDb>) {
	const appointment = await db
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', 'appt-1')
		.executeTakeFirstOrThrow();
	return appointment;
}

describe('enqueueAppointmentReconciliation', () => {
	test('only enqueues the public workflow contract without waiting for its result', async () => {
		const db = await seed();
		const appointment = await fetchRow(db);
		const workerResult = vi.fn();
		runWorkflow.mockResolvedValue({ result: workerResult });

		const result = await enqueueAppointmentReconciliation(appointment, 'confirmed');

		expect(runWorkflow).toHaveBeenCalledWith(
			reconcileAppointment,
			{
				appointmentId: 'appt-1',
				emailKind: 'confirmed'
			},
			{ idempotencyKey: 'appt-1:confirmed:0' }
		);
		expect(reconcileAppointment.name).toBe('reconcile-appointment');
		expect(result).toBeUndefined();
		expect(workerResult).not.toHaveBeenCalled();

		await db.destroy();
	});

	test('keys the supplied committed snapshot even when the database has a newer row', async () => {
		const db = await seed();
		try {
			await db.updateTable('appointments').set({ ics_sequence: 2, calendar_revision: 7 }).execute();
			const committed = await fetchRow(db);
			await db
				.updateTable('appointments')
				.set({ ics_sequence: 3, calendar_revision: 8, video_chat: 'https://newer.example/room' })
				.execute();

			await enqueueAppointmentReconciliation(
				committed,
				'edited-by-host',
				'https://old.example/room'
			);
			await enqueueAppointmentReconciliation(committed);

			expect(runWorkflow).toHaveBeenNthCalledWith(
				1,
				reconcileAppointment,
				{
					appointmentId: committed.id,
					emailKind: 'edited-by-host',
					cleanupVideoChatUrl: 'https://old.example/room'
				},
				{ idempotencyKey: 'appt-1:edited-by-host:2' }
			);
			expect(runWorkflow).toHaveBeenNthCalledWith(
				2,
				reconcileAppointment,
				{ appointmentId: committed.id, emailKind: undefined, cleanupVideoChatUrl: undefined },
				{ idempotencyKey: 'appt-1:sync:7' }
			);
			const current = await fetchRow(db);
			expect(current).toMatchObject({ ics_sequence: 3, calendar_revision: 8 });
		} finally {
			await db.destroy();
		}
	});

	test('keys by ics_sequence so a repeat same-kind send is not deduped', async () => {
		const db = await seed();
		await db
			.updateTable('appointments')
			.set({ ics_sequence: 2, calendar_revision: 7 })
			.where('id', '=', 'appt-1')
			.execute();

		const appointment = await fetchRow(db);
		await enqueueAppointmentReconciliation(appointment, 'rescheduled-by-guest');

		expect(runWorkflow).toHaveBeenCalledWith(
			reconcileAppointment,
			{ appointmentId: 'appt-1', emailKind: 'rescheduled-by-guest' },
			{ idempotencyKey: 'appt-1:rescheduled-by-guest:2' }
		);

		await db.destroy();
	});
});

describe('enqueueVideoChatGeneration', () => {
	test('uses a stable revision key and waits for submission only', async () => {
		const workerResult = vi.fn();
		runWorkflow.mockResolvedValue({ result: workerResult });

		const result = await enqueueVideoChatGeneration('appt-1', 4);
		await enqueueVideoChatGeneration('appt-1', 4);
		await enqueueVideoChatGeneration('appt-1', 5);

		expect(result).toBeUndefined();
		expect(runWorkflow).toHaveBeenNthCalledWith(
			1,
			generateVideoChat,
			{ appointmentId: 'appt-1', notificationKind: 'video-chat-added' },
			{ idempotencyKey: 'generate-video-chat:appt-1:4:video-chat-added' }
		);
		const keys = runWorkflow.mock.calls.map((call) => call[2].idempotencyKey);
		expect(keys).toEqual([
			'generate-video-chat:appt-1:4:video-chat-added',
			'generate-video-chat:appt-1:4:video-chat-added',
			'generate-video-chat:appt-1:5:video-chat-added'
		]);
		expect(workerResult).not.toHaveBeenCalled();
	});

	test('lets submission failure reach the service that saved the choice', async () => {
		const failure = new Error('queue unavailable');
		runWorkflow.mockRejectedValueOnce(failure);

		const submission = enqueueVideoChatGeneration('appt-1', 4);

		await expect(submission).rejects.toBe(failure);
	});
});

describe('producer inputs and keys', () => {
	test('forwards the cleanup URL and keys email-free reconciliation by calendar revision', async () => {
		const db = await seed();
		await db.updateTable('appointments').set({ ics_sequence: 3, calendar_revision: 7 }).execute();

		const appointment = await fetchRow(db);
		await enqueueAppointmentReconciliation(
			appointment,
			undefined,
			'https://video.example.com/obsolete-room'
		);

		expect(runWorkflow).toHaveBeenCalledWith(
			reconcileAppointment,
			{
				appointmentId: 'appt-1',
				emailKind: undefined,
				cleanupVideoChatUrl: 'https://video.example.com/obsolete-room'
			},
			{ idempotencyKey: 'appt-1:sync:7' }
		);
		await db.destroy();
	});

	test('a preference-only revision gets a new email-free key without changing email keys', async () => {
		const db = await seed();
		try {
			const original = await fetchRow(db);
			await enqueueAppointmentReconciliation(original);
			await enqueueAppointmentReconciliation(original, 'edited-by-host');
			await db
				.updateTable('appointments')
				.set({ calendar_revision: 1, video_chat_request: 'suppress' })
				.execute();
			const updated = await fetchRow(db);
			await enqueueAppointmentReconciliation(updated);
			await enqueueAppointmentReconciliation(updated, 'edited-by-host');
			await enqueueAppointmentReconciliation(updated);

			const keys = runWorkflow.mock.calls.map((call) => call[2].idempotencyKey);
			expect(keys).toEqual([
				'appt-1:sync:0',
				'appt-1:edited-by-host:0',
				'appt-1:sync:1',
				'appt-1:edited-by-host:0',
				'appt-1:sync:1'
			]);
		} finally {
			await db.destroy();
		}
	});

	test('sorts purge IDs for the key without changing row order or remote identifiers', async () => {
		const rows = [
			{ id: 'z', externalEventId: 'remote-z', externalCalendarId: 'work' },
			{ id: 'a', externalEventId: null, externalCalendarId: null }
		];

		await enqueuePurgeAppointment(rows);
		await enqueuePurgeAppointment([...rows].reverse());

		expect(purgeAppointment.name).toBe('purge-appointment');
		expect(runWorkflow).toHaveBeenNthCalledWith(
			1,
			purgeAppointment,
			{ rows },
			{ idempotencyKey: 'purge:a,z' }
		);
		expect(runWorkflow).toHaveBeenNthCalledWith(
			2,
			purgeAppointment,
			{ rows: [...rows].reverse() },
			{ idempotencyKey: 'purge:a,z' }
		);
		expect(rows.map((row) => row.id)).toEqual(['z', 'a']);
	});

	test('sync enqueues an empty input with a fresh random key and does not wait for the scan', async () => {
		const result = vi.fn();
		runWorkflow.mockResolvedValue({ result });
		const uuid = vi.spyOn(crypto, 'randomUUID');
		uuid.mockReturnValueOnce('00000000-0000-4000-8000-000000000001');
		uuid.mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
		try {
			const firstEnqueueResult = await enqueueCalendarSync();
			expect(firstEnqueueResult).toBeUndefined();
			const secondEnqueueResult = await enqueueCalendarSync();
			expect(secondEnqueueResult).toBeUndefined();
			expect(syncCalendars.name).toBe('sync-calendars');
			for (let i = 1; i <= 2; i++) {
				expect(runWorkflow).toHaveBeenNthCalledWith(
					i,
					syncCalendars,
					{},
					{
						idempotencyKey: `sync-calendars:00000000-0000-4000-8000-00000000000${i}`
					}
				);
			}
			expect(result).not.toHaveBeenCalled();
		} finally {
			uuid.mockRestore();
		}
	});

	test('concurrent video replacement and removal retain both native runs and cleanup URLs', async () => {
		const db = await seed();
		const backend = BackendSqlite.connect(':memory:');
		const client = new OpenWorkflow({ backend });
		getOpenWorkflow.mockReturnValue(client);
		try {
			await db
				.updateTable('appointments')
				.set({ video_chat: 'https://video.example/room-A' })
				.execute();
			const ctx = { db, cfg: validConfig, clock: systemClock };

			const [replacement, removal] = await Promise.all([
				editAppointment(ctx, {
					appointmentId: 'appt-1',
					video_chat: 'https://video.example/room-B'
				}),
				editAppointment(ctx, { appointmentId: 'appt-1', video_chat: null })
			]);

			expect(replacement).toMatchObject({
				ok: true,
				appointment: { video_chat: 'https://video.example/room-B', ics_sequence: 1 }
			});
			expect(removal).toMatchObject({
				ok: true,
				appointment: { video_chat: null, ics_sequence: 2 }
			});
			const current = await fetchRow(db);
			expect(current).toMatchObject({
				video_chat: null,
				video_chat_request: 'suppress',
				ics_sequence: 2,
				calendar_revision: 2
			});
			const queued = await backend.listWorkflowRuns({ limit: 10 });
			expect(queued.data).toHaveLength(2);
			expect(queued.data).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						workflowName: reconcileAppointment.name,
						idempotencyKey: 'appt-1:edited-by-host:1',
						input: {
							appointmentId: 'appt-1',
							emailKind: 'edited-by-host',
							cleanupVideoChatUrl: 'https://video.example/room-A'
						}
					}),
					expect.objectContaining({
						workflowName: reconcileAppointment.name,
						idempotencyKey: 'appt-1:edited-by-host:2',
						input: {
							appointmentId: 'appt-1',
							emailKind: 'edited-by-host',
							cleanupVideoChatUrl: 'https://video.example/room-B'
						}
					})
				])
			);
		} finally {
			await backend.stop();
			await db.destroy();
		}
	});

	test('an identical enqueue reuses terminal history within the engine dedup window', async () => {
		const db = await seed();
		const appointment = await fetchRow(db);
		const backend = BackendSqlite.connect(':memory:');
		const client = new OpenWorkflow({ backend });
		const previousHandler = vi.fn(() => 'reconciled' as const);
		const changedHandler = vi.fn(() => 'reconciled' as const);
		client.implementWorkflow(reconcileAppointment, previousHandler);
		getOpenWorkflow.mockReturnValue(client);
		const enqueue = vi.spyOn(client, 'runWorkflow');
		const worker = client.newWorker({ concurrency: 1 });
		try {
			await enqueueAppointmentReconciliation(appointment, 'confirmed');
			const first = await enqueue.mock.results[0].value;
			const processedRuns = await worker.tick();
			expect(processedRuns).toBe(1);
			await worker.stop();
			const reconciliationResult = await first.result();
			expect(reconciliationResult).toBe('reconciled');

			const restartedClient = new OpenWorkflow({ backend });
			restartedClient.implementWorkflow(reconcileAppointment, changedHandler);
			getOpenWorkflow.mockReturnValue(restartedClient);
			const repeatedEnqueue = vi.spyOn(restartedClient, 'runWorkflow');
			await enqueueAppointmentReconciliation(appointment, 'confirmed');
			const repeated = await repeatedEnqueue.mock.results[0].value;
			expect(repeated.workflowRun.id).toBe(first.workflowRun.id);
			expect(repeated.workflowRun.status).toBe('completed');
			const restartedWorker = restartedClient.newWorker({ concurrency: 1 });
			try {
				const restartedProcessedRuns = await restartedWorker.tick();
				expect(restartedProcessedRuns).toBe(0);
			} finally {
				await restartedWorker.stop();
			}
			expect(previousHandler).toHaveBeenCalledTimes(1);
			expect(changedHandler).not.toHaveBeenCalled();
		} finally {
			await worker.stop();
			await backend.stop();
			await db.destroy();
		}
	});
});
