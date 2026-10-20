import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenWorkflow } from 'openworkflow';
import { BackendSqlite } from 'openworkflow/sqlite';
import { openDb, runMigrations } from '@when/db';
import { purgeAppointment, type PurgeAppointmentInput } from '@when/jobs';
import type { WhenConfiguration } from '@when/config';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { setWorkerContext } from '../services/context.js';
import type { Logger } from '../services/logger.js';
import { runPurgeAppointment } from './purge-appointment.js';

const config = {
	providers: {
		dav: {
			type: 'caldav',
			url: 'https://cal.example.com/',
			username: 'u',
			password: 'p',
			calendars: { work: { href: 'https://cal.example.com/work/' } }
		},
		talk: {
			type: 'nextcloud',
			url: 'https://talk.example.com',
			username: 'u',
			password: 'p',
			calendars: {}
		}
	},
	meetings: { chat: { video_chat: { provider: 'talk' } } }
} as unknown as WhenConfiguration;

beforeEach(() => {
	// Only the wall clock moves; engine timers and the production retry policy stay real.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-05-01T00:00:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function seed(ids: string[]) {
	const db = openDb(':memory:');
	await runMigrations(db);
	for (const id of ids) {
		await db
			.insertInto('appointments')
			.values({
				id,
				event_type_id: 'chat',
				start_time: '2026-05-01T10:00:00Z',
				end_time: '2026-05-01T10:30:00Z',
				guest_name: 'Guest',
				guest_email: 'guest@example.com',
				guest_timezone: 'UTC',
				status: 'purged',
				cancel_token: `token-${id}`,
				external_event_id: id,
				external_calendar_id: 'work',
				video_chat: `https://talk.example.com/call/${id}`,
				created_at: '',
				updated_at: ''
			})
			.execute();
	}
	const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
	setWorkerContext({ config, db, logger: logger as unknown as Logger, mailer: { send: vi.fn() } });
	return { db, logger };
}

function input(ids: string[]): PurgeAppointmentInput {
	return { rows: ids.map((id) => ({ id, externalEventId: id, externalCalendarId: 'work' })) };
}

function provider(failures: Record<string, number>, successStatus = 204, videoStatus = 204) {
	const calendar: Record<string, number> = {};
	const video: string[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		expect(init?.method).toBe('DELETE');
		const target = new URL(String(url));
		const id = target.pathname
			.split('/')
			.at(-1)!
			.replace(/\.ics$/, '');
		if (target.hostname === 'cal.example.com') {
			calendar[id] = (calendar[id] ?? 0) + 1;
			const status = calendar[id] <= (failures[id] ?? 0) ? 500 : successStatus;
			return new Response(null, { status });
		}
		expect(target.hostname).toBe('talk.example.com');
		video.push(id);
		return new Response(null, { status: videoStatus });
	});
	return { calendar, video };
}

function openQueue(path = ':memory:') {
	const backend = BackendSqlite.connect(path);
	const client = new OpenWorkflow({ backend });
	client.implementWorkflow(purgeAppointment, ({ input, step }) => runPurgeAppointment(input, step));
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

async function readRun(queue: Queue, workflowRunId: string) {
	const run = await queue.backend.getWorkflowRun({ workflowRunId });
	expect(run).not.toBeNull();
	return run!;
}

async function attempts(queue: Queue, workflowRunId: string) {
	const first = await queue.backend.listStepAttempts({ workflowRunId, limit: 100 });
	const all = first.data;
	let after = first.pagination.next;
	while (after) {
		const page = await queue.backend.listStepAttempts({ workflowRunId, limit: 100, after });
		all.push(...page.data);
		after = page.pagination.next;
	}
	return all;
}

async function runNextPurgePass(queue: Queue, id: string) {
	const before = await readRun(queue, id);
	if (before.availableAt && before.availableAt.getTime() > Date.now()) {
		vi.setSystemTime(before.availableAt);
	}
	await vi.waitFor(async () => expect(await queue.worker.tick()).toBe(1), {
		timeout: 2000,
		interval: 1
	});
	await vi.waitFor(
		async () => {
			const run = await readRun(queue, id);
			expect(['pending', 'completed', 'failed']).toContain(run.status);
			if (run.status === 'pending') expect(run.workerId).toBeNull();
		},
		{ timeout: 2000, interval: 1 }
	);
	await queue.worker.stop();
	return readRun(queue, id);
}

async function finish(queue: Queue, id: string) {
	for (let i = 0; i < 1000; i++) {
		const run = await runNextPurgePass(queue, id);
		if (run.status !== 'pending') return run;
	}
	throw new Error('Purge did not settle within 1000 passes');
}

test('native transient retries retain the row until remote deletion succeeds', async () => {
	const { db } = await seed(['one']);
	const remote = provider({ one: 2 });
	const queue = openQueue();
	try {
		const job = await queue.client.runWorkflow(purgeAppointment, input(['one']));
		const id = job.workflowRun.id;
		expect(await runNextPurgePass(queue, id)).toMatchObject({ status: 'pending', workerId: null });
		expect(remote.video).toEqual([]);
		expect(await db.selectFrom('appointments').selectAll().execute()).toHaveLength(1);
		expect(await finish(queue, id)).toMatchObject({ status: 'completed', output: 'purged' });
		expect(await job.result({ timeoutMs: 500 })).toBe('purged');
		expect(remote.calendar).toEqual({ one: 3 });
		expect(remote.video).toEqual(['one']);
		expect(await db.selectFrom('appointments').selectAll().execute()).toEqual([]);
		expect((await attempts(queue, id)).map((attempt) => attempt.status)).toEqual([
			'failed',
			'failed',
			'completed',
			'completed',
			'completed'
		]);
	} finally {
		await queue.close();
		await db.destroy();
	}
});

test('calendar 404 enables best-effort video cleanup and local deletion', async () => {
	const { db } = await seed(['gone']);
	const remote = provider({}, 404, 500);
	const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const queue = openQueue();
	try {
		const job = await queue.client.runWorkflow(purgeAppointment, input(['gone']));
		expect(await finish(queue, job.workflowRun.id)).toMatchObject({ status: 'completed' });
		expect(remote.calendar).toEqual({ gone: 1 });
		expect(remote.video).toEqual(['gone']);
		expect(warning).toHaveBeenCalledTimes(1);
		expect(await db.selectFrom('appointments').selectAll().execute()).toEqual([]);
		expect(await attempts(queue, job.workflowRun.id)).toHaveLength(3);
	} finally {
		await queue.close();
		await db.destroy();
	}
});

test('thirty native failures fail the job, retaining current/later rows without redoing earlier success', async () => {
	const ids = ['earlier', 'current', 'later'];
	const { db, logger } = await seed(ids);
	const remote = provider({ current: 30 });
	const queue = openQueue();
	try {
		const job = await queue.client.runWorkflow(purgeAppointment, input(ids));
		const id = job.workflowRun.id;
		expect(await runNextPurgePass(queue, id)).toMatchObject({ status: 'pending' });
		const earlier = (await attempts(queue, id)).filter((attempt) =>
			attempt.stepName.endsWith(':earlier')
		);
		expect(earlier).toHaveLength(3);
		expect(await finish(queue, id)).toMatchObject({ status: 'failed', output: null });
		await expect(job.result({ timeoutMs: 500 })).rejects.toThrow(/CalDAV DELETE/);
		const recorded = await attempts(queue, id);
		expect(recorded).toHaveLength(33);
		expect(recorded.filter((attempt) => attempt.stepName.endsWith(':earlier'))).toEqual(earlier);
		const failed = recorded.filter((attempt) => attempt.stepName === 'calendar:current');
		expect(failed).toHaveLength(30);
		expect(failed.every((attempt) => attempt.status === 'failed')).toBe(true);
		expect(remote.calendar).toEqual({ earlier: 1, current: 30 });
		expect(remote.video).toEqual(['earlier']);
		const retained = await db.selectFrom('appointments').selectAll().orderBy('id').execute();
		expect(retained.map((row) => [row.id, row.status, row.video_chat])).toEqual([
			['current', 'purged', 'https://talk.example.com/call/current'],
			['later', 'purged', 'https://talk.example.com/call/later']
		]);
		expect(logger.warn).not.toHaveBeenCalled();
		expect(await queue.worker.tick()).toBe(0);
	} finally {
		await queue.close();
		await db.destroy();
	}
});

test('reopens a file queue during retry delay without replaying earlier cleanup', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'when-purge-'));
	const path = join(directory, 'queue.sqlite');
	const { db } = await seed(['earlier', 'retry']);
	const remote = provider({ retry: 2 });
	let queue = openQueue(path);
	try {
		const job = await queue.client.runWorkflow(purgeAppointment, input(['earlier', 'retry']));
		const id = job.workflowRun.id;
		const parked = await runNextPurgePass(queue, id);
		expect(parked).toMatchObject({ status: 'pending', workerId: null });
		expect(parked.availableAt!.getTime()).toBeGreaterThan(Date.now());
		const saved = await attempts(queue, id);
		expect(saved).toHaveLength(4);
		await queue.close();
		queue = openQueue(path);
		expect(await readRun(queue, id)).toEqual(parked);
		expect(await queue.worker.tick()).toBe(0);
		expect(await attempts(queue, id)).toEqual(saved);
		expect(await finish(queue, id)).toMatchObject({ status: 'completed', output: 'purged' });
		expect(remote.calendar).toEqual({ earlier: 1, retry: 3 });
		expect(remote.video).toEqual(['earlier', 'retry']);
		expect((await attempts(queue, id)).slice(0, 4)).toEqual(saved);
		expect(await db.selectFrom('appointments').selectAll().execute()).toEqual([]);
	} finally {
		await queue.close();
		await db.destroy();
		await rm(directory, { recursive: true, force: true });
	}
});

test('twenty near-budget rows complete with 640 actual step attempts, below the 1000-attempt cap', async () => {
	const ids = Array.from({ length: 20 }, (_, i) => `row-${i}`);
	const { db } = await seed(ids);
	const remote = provider(Object.fromEntries(ids.map((id) => [id, 29])));
	const queue = openQueue();
	try {
		const job = await queue.client.runWorkflow(purgeAppointment, input(ids));
		expect(await finish(queue, job.workflowRun.id)).toMatchObject({
			status: 'completed',
			output: 'purged'
		});
		const recorded = await attempts(queue, job.workflowRun.id);
		expect(recorded).toHaveLength(640);
		expect(recorded.length).toBeLessThan(1000);
		for (const id of ids) {
			const calendar = recorded.filter((attempt) => attempt.stepName === `calendar:${id}`);
			expect(calendar.filter((attempt) => attempt.status === 'failed')).toHaveLength(29);
			expect(calendar.filter((attempt) => attempt.status === 'completed')).toHaveLength(1);
			expect(remote.calendar[id]).toBe(30);
		}
		expect(
			recorded.filter((attempt) => attempt.stepName.startsWith('video-chat-cleanup:'))
		).toHaveLength(20);
		expect(recorded.filter((attempt) => attempt.stepName.startsWith('delete:'))).toHaveLength(20);
		expect(remote.video).toEqual(ids);
		expect(await db.selectFrom('appointments').selectAll().execute()).toEqual([]);
	} finally {
		await queue.close();
		await db.destroy();
	}
}, 15000);
