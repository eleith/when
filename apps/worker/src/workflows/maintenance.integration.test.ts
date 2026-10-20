import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { OpenWorkflow, type Worker } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import {
	openDb,
	runMigrations,
	findAppointment,
	listOutOfSyncAppointments,
	parseActionLog
} from '@when/db';
import {
	refreshCalendars,
	expirePendingAppointments,
	syncCalendars,
	testCalendar
} from '@when/jobs';
import { fetchBusyIntervals, pushAppointment } from '@when/calendar';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';
import { setWorkerContext, type WorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { registerWorkflows } from './index.js';

const engine = vi.hoisted(() => ({ client: null as OpenWorkflow | null }));
vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return { ...actual, getOpenWorkflow: () => engine.client! };
});
vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return { ...actual, fetchBusyIntervals: vi.fn(), pushAppointment: vi.fn() };
});

const specs = [refreshCalendars, expirePendingAppointments, syncCalendars];
const at = '2026-04-01T07:03:19.000Z';
let directory: string;
let backend: BackendSqlite;
let client: OpenWorkflow;
let worker: Worker;
let ctx: WorkerContext;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(at));
	vi.mocked(fetchBusyIntervals).mockReset().mockResolvedValue([]);
	vi.mocked(pushAppointment).mockReset().mockResolvedValue({ ok: false, reason: 'offline' });
	directory = await mkdtemp(join(tmpdir(), 'when-maintenance-'));
	const db = openDb(join(directory, 'app.sqlite'));
	await runMigrations(db);
	ctx = {
		db,
		config: { ...sampleConfig, providers: {} },
		logger: createLogger(),
		mailer: { send: async () => ({ ok: true }) }
	};
	setWorkerContext(ctx);
	backend = BackendSqlite.connect(join(directory, 'queue.sqlite'));
	client = new OpenWorkflow({ backend });
	engine.client = client;
	registerWorkflows();
	worker = client.newWorker({ concurrency: 1 });
});

afterEach(async () => {
	try {
		await worker.stop();
		await backend.stop();
		await ctx.db.destroy();
	} finally {
		vi.useRealTimers();
		await rm(directory, { recursive: true, force: true });
	}
});

async function schedules() {
	const page = await client.schedules.list({ limit: 100 });
	expect(page.pagination.next).toBeNull();
	return page.data;
}

async function runs() {
	const page = await backend.listWorkflowRuns({ limit: 100 });
	expect(page.pagination.next).toBeNull();
	return page.data;
}

async function drain(count: number) {
	for (let i = 0; i < count; i++) {
		const claimedCount = await worker.tick();
		expect(claimedCount).toBe(1);
		await worker.stop();
	}
}

function useCalendar() {
	ctx.config = {
		...ctx.config,
		providers: {
			dav: {
				type: 'caldav',
				url: 'https://calendar.example.com',
				username: 'owner',
				password: 'secret',
				calendars: {
					work: { href: '/work/', sync: { refresh_every_minutes: 10 } }
				}
			}
		},
		meetings: {
			chat: {
				title: 'Chat',
				booking_calendar: 'work',
				additional_busy_calendars: [],
				booking_window_days: 60
			}
		} as unknown as WorkerContext['config']['meetings']
	};
}

test('producer-only enqueue and implementation registration persist no schedules', async () => {
	const run = await client.runWorkflow(syncCalendars, {});
	const schedulesBeforeDrain = await schedules();
	expect(schedulesBeforeDrain).toEqual([]);
	const pendingRuns = await runs();
	expect(pendingRuns).toMatchObject([
		{ id: run.workflowRun.id, workflowName: 'sync-calendars', input: {}, status: 'pending' }
	]);
	await drain(1);
	const syncResult = await run.result({ timeoutMs: 500 });
	expect(syncResult).toBe('requested');
	const schedulesAfterDrain = await schedules();
	expect(schedulesAfterDrain).toEqual([]);
});

test('native start upserts declarations and preserves pause across a file-backed restart', async () => {
	await worker.start();
	await worker.stop();
	const initialSchedules = await schedules();
	expect(initialSchedules).toHaveLength(3);
	await client.scheduleWorkflow(
		refreshCalendars,
		{},
		{
			id: 'when:refresh-calendars',
			cron: '*/7 * * * *',
			timezone: 'UTC'
		}
	);
	await client.schedules.pause('when:sync-calendars');
	await backend.stop();
	backend = BackendSqlite.connect(join(directory, 'queue.sqlite'));
	client = new OpenWorkflow({ backend });
	engine.client = client;
	registerWorkflows();
	worker = client.newWorker({ concurrency: 1 });
	await worker.start();
	await worker.stop();
	const persisted = await schedules();
	expect(persisted).toHaveLength(3);
	for (const spec of specs) {
		const declaration = spec.schedules![0]!;
		expect(persisted.find((schedule) => schedule.id === declaration.id)).toMatchObject({
			...declaration,
			cron: `0 ${declaration.cron}`,
			workflowName: spec.name
		});
	}
	const pausedSchedule = await client.schedules.get('when:sync-calendars');
	expect(pausedSchedule).toMatchObject({ nextRunAt: null });
	const resumedSchedule = await client.schedules.resume('when:sync-calendars');
	expect(resumedSchedule).toMatchObject({
		nextRunAt: new Date('2026-04-01T07:10:00Z')
	});
});

test('UTC cron aligns to wall-clock boundaries rather than startup time', async () => {
	await worker.start();
	await worker.stop();
	const persisted = await schedules();
	const expected = new Map([
		['when:refresh-calendars', '2026-04-01T07:05:00.000Z'],
		['when:expire-pending-appointments', '2026-04-01T08:00:00.000Z'],
		['when:sync-calendars', '2026-04-01T07:10:00.000Z']
	]);
	for (const schedule of persisted) {
		expect(schedule.timezone).toBe('UTC');
		expect(schedule.nextRunAt?.toISOString()).toBe(expected.get(schedule.id));
	}
	const enqueuedBeforeFirstBoundary = await backend.enqueueScheduledRuns({
		before: new Date('2026-04-01T07:04:59Z'),
		limit: 100
	});
	expect(enqueuedBeforeFirstBoundary).toBe(0);
	const enqueuedAtFirstBoundary = await backend.enqueueScheduledRuns({
		before: new Date('2026-04-01T07:05:00Z'),
		limit: 100
	});
	expect(enqueuedAtFirstBoundary).toBe(1);
	const enqueuedBeforeSecondBoundary = await backend.enqueueScheduledRuns({
		before: new Date('2026-04-01T07:09:59Z'),
		limit: 100
	});
	expect(enqueuedBeforeSecondBoundary).toBe(0);
	const enqueuedAtSecondBoundary = await backend.enqueueScheduledRuns({
		before: new Date('2026-04-01T07:10:00Z'),
		limit: 100
	});
	expect(enqueuedAtSecondBoundary).toBe(2);
	vi.setSystemTime(new Date('2026-04-01T07:10:00Z'));
	await drain(3);
	const completedRuns = await runs();
	expect(completedRuns.every((run) => run.status === 'completed')).toBe(true);
});

test('downtime catches up once per schedule and explicit startup passes coexist with cron', async () => {
	await worker.start();
	await worker.stop();
	vi.setSystemTime(new Date('2026-04-03T15:37:00Z'));
	const before = new Date();
	const catchupCount = await backend.enqueueScheduledRuns({ before, limit: 100 });
	expect(catchupCount).toBe(3);
	const repeatedCatchupCount = await backend.enqueueScheduledRuns({ before, limit: 100 });
	expect(repeatedCatchupCount).toBe(0);
	for (const spec of specs) await client.runWorkflow(spec, {});
	await drain(6);
	const completed = await runs();
	expect(completed).toHaveLength(6);
	for (const spec of specs) {
		const matching = completed.filter((run) => run.workflowName === spec.name);
		expect(matching).toHaveLength(2);
		expect(matching.map((run) => run.workflowScheduleId)).toEqual(
			expect.arrayContaining([null, spec.schedules![0]!.id])
		);
		for (const run of matching) {
			expect(run).toMatchObject({ status: 'completed', input: {}, idempotencyKey: null });
			const attempts = await backend.listStepAttempts({ workflowRunId: run.id, limit: 100 });
			expect(attempts.data).toMatchObject([{ status: 'completed', kind: 'function' }]);
		}
	}
	for (const schedule of await schedules()) {
		expect(schedule.nextRunAt!.getTime()).toBeGreaterThan(before.getTime());
	}
});

test('paused cron survives startup but does not suppress explicit startup work', async () => {
	await worker.start();
	await worker.stop();
	for (const schedule of await schedules()) await client.schedules.pause(schedule.id);
	vi.setSystemTime(new Date('2026-04-03T15:37:00Z'));
	await worker.start();
	await worker.stop();
	const pausedSchedules = await schedules();
	expect(pausedSchedules.every((schedule) => schedule.nextRunAt === null)).toBe(true);
	const enqueuedCount = await backend.enqueueScheduledRuns({ before: new Date(), limit: 100 });
	expect(enqueuedCount).toBe(0);
	for (const spec of specs) await client.runWorkflow(spec, {});
	await drain(3);
	const completedRuns = await runs();
	expect(completedRuns).toMatchObject([
		{ status: 'completed', workflowScheduleId: null },
		{ status: 'completed', workflowScheduleId: null },
		{ status: 'completed', workflowScheduleId: null }
	]);
});

test('expiry makes a synced inherited event discoverable for cleanup without backfilling history', async () => {
	useCalendar();
	const fetch = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(new Response(null, { status: 204 }));
	try {
		for (const row of [
			{ id: 'pending', status: 'pending', start: '2026-04-01T07:03:19Z' },
			{ id: 'historical', status: 'expired', start: '2026-04-01T06:00:00Z' }
		] as const) {
			await ctx.db
				.insertInto('appointments')
				.values({
					...sampleAppointment,
					id: row.id,
					event_type_id: 'chat',
					cancel_token: `token-${row.id}`,
					status: row.status,
					start_time: row.start,
					end_time: '2026-04-01T07:30:00Z',
					external_event_id: `event-${row.id}`,
					external_calendar_id: 'work',
					calendar_revision: 4,
					calendar_synced_revision: 4,
					action_log: '[]'
				})
				.execute();
		}
		const initiallyDirty = await listOutOfSyncAppointments(ctx.db);
		expect(initiallyDirty).toEqual([]);
		const historicalBefore = await findAppointment(ctx.db, 'historical');

		const expiry = await client.runWorkflow(expirePendingAppointments, {});
		await drain(1);
		const expiryResult = await expiry.result({ timeoutMs: 500 });
		expect(expiryResult).toBe('expired');
		const expired = await findAppointment(ctx.db, 'pending');
		expect(expired).toMatchObject({
			status: 'expired',
			calendar_revision: 5,
			calendar_synced_revision: 4,
			external_event_id: 'event-pending',
			ics_sequence: 0
		});
		expect(parseActionLog(expired!.action_log)).toEqual([
			{ action: 'expire', actor: 'system', at }
		]);
		const dirty = await listOutOfSyncAppointments(ctx.db);
		expect(dirty.map((row) => row.id)).toEqual(['pending']);

		const repair = await client.runWorkflow(syncCalendars, {});
		await drain(1);
		const repairResult = await repair.result({ timeoutMs: 500 });
		expect(repairResult).toBe('requested');
		const cleaned = await findAppointment(ctx.db, 'pending');
		expect(cleaned).toMatchObject({
			status: 'expired',
			calendar_revision: 5,
			calendar_synced_revision: 5,
			external_event_id: null,
			external_calendar_id: null,
			ics_sequence: 0
		});
		expect(fetch).toHaveBeenCalledExactlyOnceWith(
			'https://calendar.example.com/work/event-pending.ics',
			expect.objectContaining({ method: 'DELETE' })
		);
		expect(pushAppointment).not.toHaveBeenCalled();

		await client.runWorkflow(expirePendingAppointments, {});
		await drain(1);
		await client.runWorkflow(syncCalendars, {});
		await drain(1);
		const afterReplay = await findAppointment(ctx.db, 'pending');
		const historicalAfter = await findAppointment(ctx.db, 'historical');
		const remainingDirty = await listOutOfSyncAppointments(ctx.db);
		expect(afterReplay).toEqual(cleaned);
		expect(historicalAfter).toEqual(historicalBefore);
		expect(remainingDirty).toEqual([]);
		expect(fetch).toHaveBeenCalledTimes(1);
	} finally {
		fetch.mockRestore();
	}
});

test('repeated sync requests serialize without coalescing and stop awaits the active pass', async () => {
	useCalendar();
	await ctx.db
		.insertInto('appointments')
		.values({ ...sampleAppointment, event_type_id: 'chat' })
		.execute();
	const release = Promise.withResolvers<void>();
	let entered = false;
	let active = 0;
	let maximumActive = 0;
	vi.mocked(pushAppointment).mockImplementation(async () => {
		active += 1;
		maximumActive = Math.max(active, maximumActive);
		entered = true;
		await release.promise;
		active -= 1;
		return { ok: false, reason: 'offline' };
	});
	const first = await client.runWorkflow(syncCalendars, {});
	try {
		const claimedCount = await worker.tick();
		expect(claimedCount).toBe(1);
		await vi.waitUntil(() => entered, { timeout: 1000, interval: 5 });
		await client.runWorkflow(syncCalendars, {});
		await client.runWorkflow(syncCalendars, {});
		const claimedWhileActive = await worker.tick();
		expect(claimedWhileActive).toBe(0);
		let stopped = false;
		const stopping = worker.stop().then(() => {
			stopped = true;
		});
		await Promise.resolve();
		expect(stopped).toBe(false);
		release.resolve();
		await stopping;
		const syncResult = await first.result({ timeoutMs: 500 });
		expect(syncResult).toBe('requested');
		const runsAfterStop = await runs();
		expect(runsAfterStop.filter((run) => run.status === 'pending')).toHaveLength(2);
		await drain(2);
		const completedRuns = await runs();
		expect(completedRuns.every((run) => run.status === 'completed')).toBe(true);
		expect(pushAppointment).toHaveBeenCalledTimes(3);
		expect(maximumActive).toBe(1);
		const runsForUniqueIds = await runs();
		expect(new Set(runsForUniqueIds.map((run) => run.id)).size).toBe(3);
	} finally {
		release.resolve();
	}
});

test('slow refresh blocks a queued probe at concurrency one until the real provider call finishes', async () => {
	useCalendar();
	const release = Promise.withResolvers<void>();
	let entered = false;
	vi.mocked(fetchBusyIntervals).mockImplementationOnce(async () => {
		entered = true;
		await release.promise;
		return [];
	});
	const refresh = await client.runWorkflow(refreshCalendars, {});
	try {
		const claimedCount = await worker.tick();
		expect(claimedCount).toBe(1);
		await vi.waitUntil(() => entered, { timeout: 1000, interval: 5 });
		const probe = await client.runWorkflow(testCalendar, { name: 'work' });
		const claimedWhileActive = await worker.tick();
		expect(claimedWhileActive).toBe(0);
		release.resolve();
		await worker.stop();
		const refreshResult = await refresh.result({ timeoutMs: 500 });
		expect(refreshResult).toBe('refreshed');
		const pendingProbe = await backend.getWorkflowRun({ workflowRunId: probe.workflowRun.id });
		expect(pendingProbe).toMatchObject({
			status: 'pending'
		});
		expect(fetchBusyIntervals).toHaveBeenCalledTimes(1);
		await drain(1);
		const probeResult = await probe.result({ timeoutMs: 500 });
		expect(probeResult).toEqual({ busyCount: 0, days: 60 });
		expect(fetchBusyIntervals).toHaveBeenCalledTimes(2);
	} finally {
		release.resolve();
	}
});

test.each(specs)(
	'$name local failure uses ten native attempts with 1s ×2 backoff capped at 100s',
	async (spec) => {
		await ctx.db.schema.dropTable('appointments').execute();
		const handle = await client.runWorkflow(spec, {});
		const delays = [1000, 2000, 4000, 8000, 16000, 32000, 64000, 100000, 100000];
		for (let i = 0; i < 10; i++) {
			const started = Date.now();
			const claimedCount = await worker.tick();
			expect(claimedCount).toBe(1);
			await worker.stop();
			const run = await backend.getWorkflowRun({ workflowRunId: handle.workflowRun.id });
			const attempts = await backend.listStepAttempts({
				workflowRunId: handle.workflowRun.id,
				limit: 100
			});
			expect(attempts.data).toHaveLength(i + 1);
			expect(attempts.data.every((attempt) => attempt.status === 'failed')).toBe(true);
			if (i < 9) {
				expect(run).toMatchObject({ status: 'pending', workerId: null });
				expect(run!.availableAt!.getTime() - started).toBe(delays[i]);
				vi.setSystemTime(run!.availableAt!);
			} else {
				expect(run).toMatchObject({ status: 'failed', output: null, workerId: null });
			}
		}
		await expect(handle.result({ timeoutMs: 500 })).rejects.toThrow();
	}
);
