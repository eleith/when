import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb, parseActionLog, runMigrations } from '@when/db';
import { scanOnce } from '../calendar/sync.js';
import { refreshCycle } from '../calendar/refresh.js';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';
import { setWorkerContext, type WorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { calendarSyncTotal } from '../services/metrics.js';
import { runSyncCalendars } from './sync-calendars.js';
import { runRefreshCalendars } from './refresh-calendars.js';
import { runExpirePendingAppointments } from './expire-pending-appointments.js';

vi.mock('../calendar/sync.js', () => ({ scanOnce: vi.fn() }));
vi.mock('../calendar/refresh.js', () => ({ refreshCycle: vi.fn() }));

const at = '2026-04-01T12:00:00.000Z';
const clock = { now: () => new Date(at), nowMs: () => Date.parse(at) };
let ctx: WorkerContext;

function makeStep() {
	const configs: { name: string }[] = [];
	return {
		configs,
		async run<T>(config: { name: string }, fn: () => Promise<T>): Promise<T> {
			configs.push(config);
			const result = await fn();
			return result;
		}
	};
}

beforeEach(async () => {
	vi.resetAllMocks();
	calendarSyncTotal.reset();
	const db = openDb(':memory:');
	await runMigrations(db);
	ctx = {
		db,
		config: sampleConfig,
		logger: createLogger(),
		mailer: { send: async () => ({ ok: true }) }
	};
	vi.spyOn(ctx.logger, 'info');
	setWorkerContext(ctx);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await ctx.db.destroy();
});

test('sync awaits the real callback and counts only completed physical scans', async () => {
	const scan = Promise.withResolvers<void>();
	vi.mocked(scanOnce).mockReturnValue(scan.promise);
	const step = makeStep();
	let completed = false;
	const running = runSyncCalendars(step).then((result) => {
		completed = true;
		return result;
	});
	await Promise.resolve();
	expect(completed).toBe(false);
	const metricsBeforeCompletion = await calendarSyncTotal.get();
	expect(metricsBeforeCompletion.values).toEqual([]);
	expect(scanOnce).toHaveBeenCalledWith(ctx);
	scan.resolve();
	const scanResult = await running;
	expect(scanResult).toBe('requested');
	expect(step.configs).toEqual([{ name: 'scan-calendars' }]);
	const metricsAfterCompletion = await calendarSyncTotal.get();
	expect(metricsAfterCompletion.values).toEqual([
		expect.objectContaining({ labels: { status: 'success' }, value: 1 })
	]);
});

test('sync callback errors escape with failure metrics', async () => {
	const error = new Error('local scan read failed');
	vi.mocked(scanOnce).mockRejectedValue(error);
	await expect(runSyncCalendars(makeStep())).rejects.toBe(error);
	const failureMetrics = await calendarSyncTotal.get();
	expect(failureMetrics.values).toEqual([
		expect.objectContaining({ labels: { status: 'failure' }, value: 1 })
	]);
});

test('an opaque engine escape is not counted as a failed scan', async () => {
	const error = new Error('opaque engine escape');
	const step = { run: vi.fn().mockRejectedValue(error) };
	await expect(runSyncCalendars(step)).rejects.toBe(error);
	expect(scanOnce).not.toHaveBeenCalled();
	const metrics = await calendarSyncTotal.get();
	expect(metrics.values).toEqual([]);
});

test('refresh awaits the cycle with injectable options and native step defaults', async () => {
	const cycle = Promise.withResolvers<void>();
	vi.mocked(refreshCycle).mockReturnValue(cycle.promise);
	const opts = { now: Temporal.Instant.from(at), via: 'refresh' as const };
	const step = makeStep();
	let completed = false;
	const running = runRefreshCalendars(step, opts).then((result) => {
		completed = true;
		return result;
	});
	await Promise.resolve();
	expect(completed).toBe(false);
	expect(refreshCycle).toHaveBeenCalledWith(ctx, opts);
	cycle.resolve();
	const refreshResult = await running;
	expect(refreshResult).toBe('refreshed');
	expect(step.configs).toEqual([{ name: 'refresh-calendars' }]);
});

test('refresh local errors and engine escapes propagate unchanged', async () => {
	const error = new Error('mirror write failed');
	vi.mocked(refreshCycle).mockRejectedValue(error);
	await expect(runRefreshCalendars(makeStep())).rejects.toBe(error);
	const engineError = new Error('opaque engine escape');
	await expect(runRefreshCalendars({ run: vi.fn().mockRejectedValue(engineError) })).rejects.toBe(
		engineError
	);
});

test('expiry uses the injected clock, is idempotent, and logs the changed count', async () => {
	const cases = [
		{ id: 'stale', status: 'pending', start: '2026-04-01T11:00:00Z', expectedStatus: 'expired' },
		{ id: 'boundary', status: 'pending', start: at, expectedStatus: 'expired' },
		{ id: 'future', status: 'pending', start: '2026-04-01T13:00:00Z', expectedStatus: 'pending' },
		{
			id: 'confirmed',
			status: 'confirmed',
			start: '2026-04-01T11:00:00Z',
			expectedStatus: 'confirmed'
		},
		{ id: 'purged', status: 'purged', start: '2026-04-01T11:00:00Z', expectedStatus: 'purged' }
	] as const;
	for (const { id, status, start } of cases) {
		await ctx.db
			.insertInto('appointments')
			.values({
				...sampleAppointment,
				id,
				event_type_id: id,
				cancel_token: `token-${id}`,
				status,
				start_time: start,
				calendar_synced_revision: 0,
				action_log: '[]'
			})
			.execute();
	}
	const step = makeStep();
	const firstExpiryResult = await runExpirePendingAppointments(step, clock);
	expect(firstExpiryResult).toBe('expired');
	const repeatedExpiryResult = await runExpirePendingAppointments(step, clock);
	expect(repeatedExpiryResult).toBe('expired');
	for (const { id, expectedStatus } of cases) {
		const row = await ctx.db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirstOrThrow();
		expect(row.status).toBe(expectedStatus);
		expect(row.calendar_revision).toBe(expectedStatus === 'expired' ? 1 : 0);
		expect(row.calendar_synced_revision).toBe(0);
		expect(row.ics_sequence).toBe(0);
		if (expectedStatus === 'expired') {
			expect(parseActionLog(row.action_log)).toEqual([{ action: 'expire', actor: 'system', at }]);
		} else {
			expect(parseActionLog(row.action_log)).toEqual([]);
		}
	}
	expect(ctx.logger.info).toHaveBeenCalledExactlyOnceWith(
		{ count: 2 },
		'expired stale pending requests'
	);
	expect(step.configs).toEqual([
		{ name: 'expire-pending-appointments' },
		{ name: 'expire-pending-appointments' }
	]);
});

test('expiry local SQL errors escape rather than completing the pass', async () => {
	await ctx.db.schema.dropTable('appointments').execute();
	await expect(runExpirePendingAppointments(makeStep(), clock)).rejects.toThrow();
	expect(ctx.logger.info).not.toHaveBeenCalled();
});
