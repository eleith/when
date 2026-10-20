import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations } from '@when/db';
import { OpenWorkflow } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';

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
	enqueueCalendarSync,
	enqueuePurgeAppointment
} from './index';
import { reconcileAppointment, syncCalendars, purgeAppointment } from '@when/jobs';

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

describe('enqueueAppointmentReconciliation', () => {
	test('returns the appointment and enqueues the public workflow contract', async () => {
		const db = await seed();

		const result = await enqueueAppointmentReconciliation(db, 'appt-1', 'confirmed');

		expect(runWorkflow).toHaveBeenCalledWith(
			reconcileAppointment,
			{
				appointmentId: 'appt-1',
				emailKind: 'confirmed'
			},
			{ idempotencyKey: 'appt-1:confirmed:0' }
		);
		expect(reconcileAppointment.name).toBe('reconcile-appointment');
		expect(result.id).toBe('appt-1');

		await db.destroy();
	});

	test('keys by ics_sequence so a repeat same-kind send is not deduped', async () => {
		const db = await seed();
		await db
			.updateTable('appointments')
			.set({ ics_sequence: 2 })
			.where('id', '=', 'appt-1')
			.execute();

		await enqueueAppointmentReconciliation(db, 'appt-1', 'rescheduled-by-guest');

		expect(runWorkflow).toHaveBeenCalledWith(
			reconcileAppointment,
			{ appointmentId: 'appt-1', emailKind: 'rescheduled-by-guest' },
			{ idempotencyKey: 'appt-1:rescheduled-by-guest:2' }
		);

		await db.destroy();
	});
});

describe('unchanged producer inputs and keys', () => {
	test('forwards the cleanup URL and keys email-free reconciliation by sequence', async () => {
		const db = await seed();
		await db.updateTable('appointments').set({ ics_sequence: 3 }).execute();

		await enqueueAppointmentReconciliation(
			db,
			'appt-1',
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
			{ idempotencyKey: 'appt-1:sync:3' }
		);
		await db.destroy();
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

	test('an identical enqueue reuses terminal history within the engine dedup window', async () => {
		const db = await seed();
		const backend = BackendSqlite.connect(':memory:');
		const client = new OpenWorkflow({ backend });
		const previousHandler = vi.fn(() => 'reconciled' as const);
		const changedHandler = vi.fn(() => 'reconciled' as const);
		client.implementWorkflow(reconcileAppointment, previousHandler);
		getOpenWorkflow.mockReturnValue(client);
		const enqueue = vi.spyOn(client, 'runWorkflow');
		const worker = client.newWorker({ concurrency: 1 });
		try {
			await enqueueAppointmentReconciliation(db, 'appt-1', 'confirmed');
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
			await enqueueAppointmentReconciliation(db, 'appt-1', 'confirmed');
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
