import { expect, test, vi, beforeEach } from 'vitest';
import pino from 'pino';
import type { WhenConfiguration } from '@when/config';
import { openDb, runMigrations, listOutOfSyncAppointments, parseActionLog } from '@when/db';
import type { Logger } from '../services/logger.js';
import type { WorkerContext } from '../services/context.js';
import { reconcileAppointment, scanOnce } from './sync.js';

const silent: Logger = pino({ level: 'silent' });

const config = {
	user: { name: 'Jane', email: 'jane@example.com', timezone: 'America/New_York' },
	url: { app: 'https://when.example.com' },
	providers: [
		{
			name: 'work-dav',
			type: 'caldav',
			url: 'https://cal.example.com/work/',
			username: 'u',
			password: 'p'
		}
	],
	calendars: [
		{
			name: 'work',
			type: 'caldav',
			provider: 'work-dav',
			url: 'https://cal.example.com/work/'
		}
	],
	meetings: [{ name: 'chat', slug: 'chat', booking_calendar: 'work', duration_minutes: 30 }]
} as unknown as WhenConfiguration;

const appt = (over: Record<string, unknown>) => ({
	id: 'a',
	event_type_id: 'chat',
	start_time: '2026-05-01T10:00:00Z',
	end_time: '2026-05-01T10:30:00Z',
	guest_name: 'A',
	guest_email: 'a@example.com',
	location: null,
	status: 'confirmed' as const,
	cancel_token: 't',
	external_event_id: null,
	external_calendar_id: null,
	calendar_revision: 0,
	ics_sequence: 0,
	has_possible_conflict: 0,
	meeting_snapshot: null,
	guest_answers: null,
	guest_timezone: 'UTC',
	created_at: '',
	updated_at: '',
	...over
});

async function ctxWith(): Promise<WorkerContext> {
	const db = openDb(':memory:');
	await runMigrations(db);
	return { config, logger: silent, db, mailer: { send: async () => ({ ok: true as const }) } };
}

function recordingFetch(status = 204) {
	const calls: { method: string; url: string }[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(
		async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
			calls.push({ method: (init?.method as string) ?? 'GET', url: String(url) });
			return new Response(null, { status });
		}
	);
	return { calls };
}

beforeEach(() => {
	vi.restoreAllMocks();
});

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
		const { calls } = recordingFetch(201);
		await reconcileAppointment(ctx, await onlyRow(ctx));
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

		recordingFetch(500);
		await reconcileAppointment(ctx, await onlyRow(ctx));
		expect((await rowById(ctx.db, '1')).calendar_synced_revision).toBeNull(); // still out of sync
		expect(await calendarJobStates(ctx.db, '1')).toEqual(['failed']);

		// a second failing scan doesn't append a second `failed`
		recordingFetch(500);
		await reconcileAppointment(ctx, await onlyRow(ctx));
		expect(await calendarJobStates(ctx.db, '1')).toEqual(['failed']);

		recordingFetch(201);
		await reconcileAppointment(ctx, await onlyRow(ctx));
		expect(await calendarJobStates(ctx.db, '1')).toEqual(['failed', 'done']);
	} finally {
		await ctx.db.destroy();
	}
});

test('a successful push records the calendar and its provider', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: '1', cancel_token: 't1', calendar_revision: 1 });
		recordingFetch(201);
		await reconcileAppointment(ctx, await onlyRow(ctx));

		const rows = await ctx.db.selectFrom('service_status').selectAll().execute();
		expect(rows.map((r) => `${r.kind}/${r.name}`).sort()).toEqual([
			'calendar/work',
			'provider/work-dav'
		]);
		for (const row of rows) {
			expect(row.via).toBe('push');
			expect(row.error).toBeNull();
		}
	} finally {
		await ctx.db.destroy();
	}
});

test('a failing push marks the calendar and its provider failing', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: '1', cancel_token: 't1', calendar_revision: 1 });
		recordingFetch(507);
		await reconcileAppointment(ctx, await onlyRow(ctx));

		const rows = await ctx.db.selectFrom('service_status').selectAll().execute();
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row.error).toBeTruthy();
			expect(row.failing_since).toBeTruthy();
			expect(row.last_ok_at).toBeNull();
		}
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
		const { calls } = recordingFetch(204);
		await reconcileAppointment(ctx, await onlyRow(ctx));
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
		const { calls } = recordingFetch(204);
		await reconcileAppointment(ctx, await onlyRow(ctx));
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
		const { calls } = recordingFetch(204);
		await reconcileAppointment(ctx, await onlyRow(ctx));
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
		const { calls } = recordingFetch(204);
		await reconcileAppointment(ctx, await onlyRow(ctx));
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
		const { calls } = recordingFetch();
		await reconcileAppointment(ctx, await onlyRow(ctx));
		const row = await rowById(ctx.db, '1');
		expect(row.calendar_synced_revision).toBe(2);
		expect(calls).toHaveLength(0);
		expect(await calendarJobStates(ctx.db, '1')).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});

test('confirmed with no destination calendar is a no-op marked synced', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: '1', cancel_token: 't1', event_type_id: 'gone', calendar_revision: 1 });
		const { calls } = recordingFetch();
		await reconcileAppointment(ctx, await onlyRow(ctx));
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
		recordingFetch(201);
		await scanOnce(ctx);
		expect((await rowById(ctx.db, '1')).calendar_synced_revision).toBe(1);

		await ctx.db
			.updateTable('appointments')
			.set({ calendar_revision: 2, start_time: '2026-05-01T11:00:00Z' })
			.where('id', '=', '1')
			.execute();
		expect((await listOutOfSyncAppointments(ctx.db)).map((r) => r.id)).toEqual(['1']);

		recordingFetch(201);
		await scanOnce(ctx);
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
		const { calls } = recordingFetch();
		await scanOnce(ctx);
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
		const { calls } = recordingFetch();
		await scanOnce(ctx);
		const row = await rowById(ctx.db, '1');
		expect(row.calendar_synced_revision).toBe(2);
		expect(row.external_event_id).toBeNull();
		expect(calls).toHaveLength(0);
	} finally {
		await ctx.db.destroy();
	}
});
