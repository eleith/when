import { expect, test } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import type { FetchFn } from '@when/calendar';
import { openDb, runMigrations, listOutOfSyncAppointments, parseActionLog } from '@when/db';
import type { Logger } from '../services/logger.js';
import type { WorkerContext } from '../services/context.js';
import { reconcileAppointment, scanOnce } from './sync.js';

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const config = {
	user: { name: 'Jane', email: 'jane@example.com', timezone: 'America/New_York' },
	url: { app: 'https://when.example.com' },
	calendars: [
		{
			id: 'work',
			type: 'caldav',
			url: 'https://cal.example.com/work/',
			username: 'u',
			password: 'p'
		}
	],
	event_types: [
		{ id: 'chat', name: 'Chat', slug: 'chat', destination_calendar: 'work', duration: 30 }
	]
} as unknown as WhenConfiguration;

const appt = (over: Record<string, unknown>) => ({
	id: 'a',
	event_type_id: 'chat',
	start_time: '2026-05-01T10:00:00Z',
	end_time: '2026-05-01T10:30:00Z',
	attendee_name: 'A',
	attendee_email: 'a@example.com',
	location: null,
	status: 'confirmed' as const,
	cancel_token: 't',
	external_event_id: null,
	external_calendar_id: null,
	...over
});

async function ctxWith(): Promise<WorkerContext> {
	const db = openDb(':memory:');
	await runMigrations(db);
	return { config, logger: silent, db, mailer: { send: async () => ({ ok: true as const }) } };
}

function recordingFetch(status = 204) {
	const calls: { method: string; url: string }[] = [];
	const fetchImpl: FetchFn = async (url, init) => {
		calls.push({ method: (init?.method as string) ?? 'GET', url: String(url) });
		return new Response(null, { status });
	};
	return { fetchImpl, calls };
}

const rowById = (db: WorkerContext['db'], id: string) =>
	db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

const calendarJobStates = async (db: WorkerContext['db'], id: string) => {
	const row = await rowById(db, id);
	return parseActionLog(row.action_log)
		.filter((e) => e.action === 'calendar')
		.map((e) => e.payload?.metadata?.state);
};

const insert = (ctx: WorkerContext, over: Record<string, unknown>) =>
	ctx.db.insertInto('appointments').values(appt(over)).execute();

const onlyRow = async (ctx: WorkerContext) => (await listOutOfSyncAppointments(ctx.db))[0];

test('confirmed without an external event is created and marked synced', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: '1', cancel_token: 't1', calendar_revision: 1 });
		const { fetchImpl, calls } = recordingFetch(201);
		await reconcileAppointment(ctx, await onlyRow(ctx), { fetchImpl });
		const row = await rowById(ctx.db, '1');
		expect(row.external_event_id).toBe('1');
		expect(row.external_calendar_id).toBe('work');
		expect(row.calendar_synced_revision).toBe(1);
		expect(calls.some((c) => c.method === 'PUT')).toBe(true);
		expect(await calendarJobStates(ctx.db, '1')).toEqual(['done']);
	} finally {
		await ctx.db.destroy();
	}
});

test('a failing publish logs failed once; a later success appends done', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: '1', cancel_token: 't1', calendar_revision: 1 });

		await reconcileAppointment(ctx, await onlyRow(ctx), {
			fetchImpl: recordingFetch(500).fetchImpl
		});
		expect((await rowById(ctx.db, '1')).calendar_synced_revision).toBeNull(); // still out of sync
		// failed logged and still open (no done) — this is the log's "failing since"
		expect(await calendarJobStates(ctx.db, '1')).toEqual(['failed']);

		// a second failing scan doesn't append a second `failed`
		await reconcileAppointment(ctx, await onlyRow(ctx), {
			fetchImpl: recordingFetch(500).fetchImpl
		});
		expect(await calendarJobStates(ctx.db, '1')).toEqual(['failed']);

		await reconcileAppointment(ctx, await onlyRow(ctx), {
			fetchImpl: recordingFetch(201).fetchImpl
		});
		expect(await calendarJobStates(ctx.db, '1')).toEqual(['failed', 'done']);
	} finally {
		await ctx.db.destroy();
	}
});

test('confirmed with an external event is updated', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, {
			id: '1',
			cancel_token: 't1',
			external_event_id: '1',
			external_calendar_id: 'work',
			calendar_revision: 2,
			calendar_synced_revision: 1
		});
		const { fetchImpl, calls } = recordingFetch(204);
		await reconcileAppointment(ctx, await onlyRow(ctx), { fetchImpl });
		const row = await rowById(ctx.db, '1');
		expect(row.calendar_synced_revision).toBe(2);
		expect(calls.some((c) => c.method === 'PUT')).toBe(true);
		expect(await calendarJobStates(ctx.db, '1')).toEqual(['done']);
	} finally {
		await ctx.db.destroy();
	}
});

test('a should-not-exist row with an external event is deleted and ids cleared', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, {
			id: '1',
			cancel_token: 't1',
			status: 'cancelled',
			external_event_id: '1',
			external_calendar_id: 'work',
			calendar_revision: 2,
			calendar_synced_revision: 1
		});
		const { fetchImpl, calls } = recordingFetch(204);
		await reconcileAppointment(ctx, await onlyRow(ctx), { fetchImpl });
		const row = await rowById(ctx.db, '1');
		expect(row.external_event_id).toBeNull();
		expect(row.external_calendar_id).toBeNull();
		expect(row.calendar_synced_revision).toBe(2);
		expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
		expect(await calendarJobStates(ctx.db, '1')).toEqual(['done']);
	} finally {
		await ctx.db.destroy();
	}
});

test('a rescheduled row keeps its event (inherited by the successor) and is marked synced', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, {
			id: '1',
			cancel_token: 't1',
			status: 'rescheduled',
			external_event_id: '1',
			external_calendar_id: 'work',
			calendar_revision: 2,
			calendar_synced_revision: 1
		});
		const { fetchImpl, calls } = recordingFetch(204);
		await reconcileAppointment(ctx, await onlyRow(ctx), { fetchImpl });
		const row = await rowById(ctx.db, '1');
		expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
		expect(row.external_event_id).toBe('1');
		expect(row.calendar_synced_revision).toBe(2);
	} finally {
		await ctx.db.destroy();
	}
});

test('a pending row that inherited an event keeps it (frozen until re-approval)', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, {
			id: '1',
			cancel_token: 't1',
			status: 'pending',
			external_event_id: '1',
			external_calendar_id: 'work',
			calendar_revision: 2,
			calendar_synced_revision: 1
		});
		const { fetchImpl, calls } = recordingFetch(204);
		await reconcileAppointment(ctx, await onlyRow(ctx), { fetchImpl });
		const row = await rowById(ctx.db, '1');
		expect(calls).toHaveLength(0);
		expect(row.external_event_id).toBe('1');
		expect(row.calendar_synced_revision).toBe(2);
	} finally {
		await ctx.db.destroy();
	}
});

test('a should-not-exist row with no external event is a no-op marked synced', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: '1', cancel_token: 't1', status: 'cancelled', calendar_revision: 2 });
		const { fetchImpl, calls } = recordingFetch();
		await reconcileAppointment(ctx, await onlyRow(ctx), { fetchImpl });
		const row = await rowById(ctx.db, '1');
		expect(row.calendar_synced_revision).toBe(2);
		expect(calls).toHaveLength(0);
		// a no-op sync (nothing to delete) logs no calendar job
		expect(await calendarJobStates(ctx.db, '1')).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});

test('confirmed with no destination calendar is a no-op marked synced', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: '1', cancel_token: 't1', event_type_id: 'gone', calendar_revision: 1 });
		const { fetchImpl, calls } = recordingFetch();
		await reconcileAppointment(ctx, await onlyRow(ctx), { fetchImpl });
		const row = await rowById(ctx.db, '1');
		expect(row.calendar_synced_revision).toBe(1);
		expect(calls).toHaveLength(0);
	} finally {
		await ctx.db.destroy();
	}
});

test('trace: a reschedule after a sync stays out of sync and is caught next scan', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: '1', cancel_token: 't1', calendar_revision: 1 });
		const { fetchImpl } = recordingFetch(201);
		await scanOnce(ctx, { fetchImpl });
		expect((await rowById(ctx.db, '1')).calendar_synced_revision).toBe(1);

		await ctx.db
			.updateTable('appointments')
			.set({ calendar_revision: 2, start_time: '2026-05-01T11:00:00Z' })
			.where('id', '=', '1')
			.execute();
		expect((await listOutOfSyncAppointments(ctx.db)).map((r) => r.id)).toEqual(['1']);

		await scanOnce(ctx, { fetchImpl });
		const row = await rowById(ctx.db, '1');
		expect(row.calendar_synced_revision).toBe(2);
		expect(row.external_event_id).toBe('1');
		expect(await listOutOfSyncAppointments(ctx.db)).toHaveLength(0);
	} finally {
		await ctx.db.destroy();
	}
});

test('the reconcile sweep skips purged rows (the purge workflow owns them)', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, {
			id: '1',
			cancel_token: 't1',
			status: 'purged',
			external_event_id: '1',
			external_calendar_id: 'work',
			calendar_revision: 2
		});
		const { fetchImpl, calls } = recordingFetch();
		await scanOnce(ctx, { fetchImpl });
		const row = await rowById(ctx.db, '1');
		expect(calls).toHaveLength(0);
		expect(row.calendar_synced_revision).toBeNull();
	} finally {
		await ctx.db.destroy();
	}
});

test('trace: a cancel before the worker runs leaves no orphan event', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: '1', cancel_token: 't1', status: 'cancelled', calendar_revision: 2 });
		const { fetchImpl, calls } = recordingFetch();
		await scanOnce(ctx, { fetchImpl });
		const row = await rowById(ctx.db, '1');
		expect(row.calendar_synced_revision).toBe(2);
		expect(row.external_event_id).toBeNull();
		expect(calls).toHaveLength(0);
	} finally {
		await ctx.db.destroy();
	}
});
