import { beforeEach, expect, test, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { openDb, runMigrations, recordRefreshResult } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import type { Logger } from '../services/logger.js';
import type { WorkerContext } from '../services/context.js';

const runWorkflow = vi.fn();
vi.mock('@when/jobs', () => ({
	getOpenWorkflow: () => ({ runWorkflow }),
	sendOwnerAlert: { spec: { name: 'send-owner-alert' } }
}));

import { evaluateHealth } from './health.js';

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const config = {
	calendars: [{ id: 'work' }],
	event_types: [{ id: 'chat', destination_calendar: 'work' }]
} as unknown as WhenConfiguration;

const START = Temporal.Instant.from('2026-05-01T00:00:00Z');

async function ctxWith(cfg: WhenConfiguration = config): Promise<WorkerContext> {
	const db = openDb(':memory:');
	await runMigrations(db);
	return { config: cfg, logger: silent, db, mailer: { send: async () => ({ ok: true as const }) } };
}

const health = (ctx: WorkerContext, id: string) =>
	ctx.db
		.selectFrom('calendar_sync_status')
		.select('health')
		.where('calendar_id', '=', id)
		.executeTakeFirstOrThrow()
		.then((r) => r.health);

const appt = (over: Record<string, unknown>) => ({
	id: 'a',
	event_type_id: 'chat',
	start_time: '2026-06-01T10:00:00Z',
	end_time: '2026-06-01T10:30:00Z',
	attendee_name: 'A',
	attendee_email: 'a@example.com',
	location: null,
	status: 'confirmed' as const,
	cancel_token: 't',
	external_event_id: null,
	external_calendar_id: null,
	...over
});

beforeEach(() => runWorkflow.mockReset());

test('a calendar that goes stale flips to bad and alerts; recovery flips back and alerts', async () => {
	const ctx = await ctxWith();
	try {
		await recordRefreshResult(ctx.db, 'work', { at: START.toString() });

		// fresh + recently refreshed → good, no alert (unknown→good isn't an edge)
		await evaluateHealth(ctx, { now: START.add({ minutes: 5 }), startedAt: START });
		expect(await health(ctx, 'work')).toBe('good');
		expect(runWorkflow).not.toHaveBeenCalled();

		// 2h with no refresh → stale → bad + a "broke" alert
		await evaluateHealth(ctx, { now: START.add({ hours: 2 }), startedAt: START });
		expect(await health(ctx, 'work')).toBe('bad');
		expect(runWorkflow).toHaveBeenCalledTimes(1);
		expect(runWorkflow.mock.calls[0][1]).toMatchObject({ calendarId: 'work', kind: 'broke' });

		// refresh succeeds → good + a "recovered" alert
		await recordRefreshResult(ctx.db, 'work', {
			at: START.add({ hours: 2, minutes: 10 }).toString()
		});
		await evaluateHealth(ctx, { now: START.add({ hours: 2, minutes: 11 }), startedAt: START });
		expect(await health(ctx, 'work')).toBe('good');
		expect(runWorkflow).toHaveBeenCalledTimes(2);
		expect(runWorkflow.mock.calls[1][1]).toMatchObject({ kind: 'recovered' });
	} finally {
		await ctx.db.destroy();
	}
});

test('a never-synced calendar stays unknown through the startup grace, then goes bad', async () => {
	const ctx = await ctxWith();
	try {
		await recordRefreshResult(ctx.db, 'work', { at: START.toString(), error: 'down' });

		await evaluateHealth(ctx, { now: START.add({ minutes: 5 }), startedAt: START });
		expect(await health(ctx, 'work')).toBe('unknown');
		expect(runWorkflow).not.toHaveBeenCalled();

		await evaluateHealth(ctx, { now: START.add({ minutes: 20 }), startedAt: START });
		expect(await health(ctx, 'work')).toBe('bad');
		expect(runWorkflow).toHaveBeenCalledTimes(1);
	} finally {
		await ctx.db.destroy();
	}
});

test('a publish failing past the threshold makes the target calendar bad', async () => {
	const ctx = await ctxWith();
	try {
		await recordRefreshResult(ctx.db, 'work', { at: START.toString() }); // reads fine
		await ctx.db
			.insertInto('appointments')
			.values(
				appt({
					id: '1',
					external_calendar_id: 'work',
					calendar_push_notification_status: 'queued',
					calendar_push_failing_since: START.subtract({ minutes: 40 }).toString()
				})
			)
			.execute();

		await evaluateHealth(ctx, { now: START.add({ minutes: 5 }), startedAt: START });
		expect(await health(ctx, 'work')).toBe('bad');
		expect(runWorkflow.mock.calls[0][1]).toMatchObject({ kind: 'broke' });

		// the stuck publish is now surfaced as failed (not just queued)
		const row = await ctx.db
			.selectFrom('appointments')
			.select('calendar_push_notification_status')
			.where('id', '=', '1')
			.executeTakeFirstOrThrow();
		expect(row.calendar_push_notification_status).toBe('failed');
	} finally {
		await ctx.db.destroy();
	}
});

test('staleness is relative to each calendar interval — a slow calendar is not flagged at its interval', async () => {
	const slowConfig = {
		calendars: [{ id: 'work', sync: { refresh_interval: 60 } }],
		event_types: []
	} as unknown as WhenConfiguration;
	const ctx = await ctxWith(slowConfig);
	try {
		await recordRefreshResult(ctx.db, 'work', { at: START.toString() });

		// 70 min on: a flat 60-min threshold would flag this, but interval(60)+grace(30) → still good
		await evaluateHealth(ctx, { now: START.add({ minutes: 70 }), startedAt: START });
		expect(await health(ctx, 'work')).toBe('good');

		// past interval + grace (90 min) → bad
		await evaluateHealth(ctx, { now: START.add({ minutes: 100 }), startedAt: START });
		expect(await health(ctx, 'work')).toBe('bad');
	} finally {
		await ctx.db.destroy();
	}
});
