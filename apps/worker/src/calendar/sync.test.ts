import { expect, test, vi, beforeEach } from 'vitest';
import pino from 'pino';
import type { WhenConfiguration } from '@when/config';
import { openDb, runMigrations, listOutOfSyncAppointments, parseActionLog } from '@when/db';
import type { Logger } from '../services/logger.js';
import type { WorkerContext } from '../services/context.js';
import { reconcileAppointment, scanOnce } from './sync.js';
import { cleanupAppointmentVideoChat } from '../services/video-chat-cleanup.js';

vi.mock('../services/video-chat-cleanup.js', () => ({
	cleanupAppointmentVideoChat: vi.fn(async () => true)
}));

const silent: Logger = pino({ level: 'silent' });

const config = {
	user: { name: 'Jane', email: 'jane@example.com', timezone: 'America/New_York' },
	url: { app: 'https://when.example.com' },
	providers: {
		'work-dav': {
			type: 'caldav',
			url: 'https://cal.example.com/work/',
			username: 'u',
			password: 'p',
			calendars: { work: { href: 'https://cal.example.com/work/' } }
		}
	},
	meetings: { chat: { title: 'chat', booking_calendar: 'work', duration_minutes: 30 } }
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
	vi.mocked(cleanupAppointmentVideoChat).mockReset().mockResolvedValue(true);
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

const onlyRow = async (ctx: WorkerContext) => {
	const rows = await listOutOfSyncAppointments(ctx.db);
	return rows[0];
};

test('confirmed without an external event is created and marked synced', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: '1', cancel_token: 't1', calendar_revision: 1 });
		const { calls } = recordingFetch(201);
		const snapshot = await onlyRow(ctx);
		await reconcileAppointment(ctx, snapshot);
		const row = await rowById(ctx.db, '1');
		expect(row.external_event_id).toBe('1');
		expect(row.external_calendar_id).toBe('work');
		expect(row.calendar_synced_revision).toBe(1);
		expect(calls.some((c) => c.method === 'PUT')).toBe(true);
		const states = await calendarJobStates(ctx.db, '1');
		expect(states).toEqual(['done']);
	} finally {
		await ctx.db.destroy();
	}
});

test('a failing publish logs failed once; a later success appends done', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: '1', cancel_token: 't1', calendar_revision: 1 });

		recordingFetch(500);
		const firstAttempt = await onlyRow(ctx);
		await reconcileAppointment(ctx, firstAttempt);
		const failedRow = await rowById(ctx.db, '1');
		expect(failedRow.calendar_synced_revision).toBeNull(); // still out of sync
		const firstFailureStates = await calendarJobStates(ctx.db, '1');
		expect(firstFailureStates).toEqual(['failed']);

		// a second failing scan doesn't append a second `failed`
		recordingFetch(500);
		const retryAttempt = await onlyRow(ctx);
		await reconcileAppointment(ctx, retryAttempt);
		const retryStates = await calendarJobStates(ctx.db, '1');
		expect(retryStates).toEqual(['failed']);

		recordingFetch(201);
		const successfulAttempt = await onlyRow(ctx);
		await reconcileAppointment(ctx, successfulAttempt);
		const recoveredStates = await calendarJobStates(ctx.db, '1');
		expect(recoveredStates).toEqual(['failed', 'done']);
	} finally {
		await ctx.db.destroy();
	}
});

test('a successful push records the calendar and its provider', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: '1', cancel_token: 't1', calendar_revision: 1 });
		recordingFetch(201);
		const snapshot = await onlyRow(ctx);
		await reconcileAppointment(ctx, snapshot);

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
		const snapshot = await onlyRow(ctx);
		await reconcileAppointment(ctx, snapshot);

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
		const snapshot = await onlyRow(ctx);
		await reconcileAppointment(ctx, snapshot);
		const row = await rowById(ctx.db, '1');
		expect(row.calendar_synced_revision).toBe(2);
		expect(calls.some((c) => c.method === 'PUT')).toBe(true);
		const states = await calendarJobStates(ctx.db, '1');
		expect(states).toEqual(['done']);
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
		const snapshot = await onlyRow(ctx);
		await reconcileAppointment(ctx, snapshot);
		const row = await rowById(ctx.db, '1');
		expect(row.external_event_id).toBeNull();
		expect(row.external_calendar_id).toBeNull();
		expect(row.calendar_synced_revision).toBe(2);
		expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
		const states = await calendarJobStates(ctx.db, '1');
		expect(states).toEqual(['done']);
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
		const snapshot = await onlyRow(ctx);
		await reconcileAppointment(ctx, snapshot);
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
		const snapshot = await onlyRow(ctx);
		await reconcileAppointment(ctx, snapshot);
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
		const snapshot = await onlyRow(ctx);
		await reconcileAppointment(ctx, snapshot);
		const row = await rowById(ctx.db, '1');
		expect(row.calendar_synced_revision).toBe(2);
		expect(calls).toHaveLength(0);
		const states = await calendarJobStates(ctx.db, '1');
		expect(states).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});

test('confirmed with no destination calendar is a no-op marked synced', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: '1', cancel_token: 't1', event_type_id: 'gone', calendar_revision: 1 });
		const { calls } = recordingFetch();
		const snapshot = await onlyRow(ctx);
		await reconcileAppointment(ctx, snapshot);
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
		const syncedRow = await rowById(ctx.db, '1');
		expect(syncedRow.calendar_synced_revision).toBe(1);

		await ctx.db
			.updateTable('appointments')
			.set({ calendar_revision: 2, start_time: '2026-05-01T11:00:00Z' })
			.where('id', '=', '1')
			.execute();
		const staleRows = await listOutOfSyncAppointments(ctx.db);
		expect(staleRows.map((row) => row.id)).toEqual(['1']);

		recordingFetch(201);
		await scanOnce(ctx);
		const row = await rowById(ctx.db, '1');
		expect(row.calendar_synced_revision).toBe(2);
		expect(row.external_event_id).toBe('1');
		const remaining = await listOutOfSyncAppointments(ctx.db);
		expect(remaining).toHaveLength(0);
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

test('a concurrent content edit still records the created reference without overwriting the selected URI', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { calendar_revision: 1, video_chat: 'https://old.example/room' });
		const snapshot = await onlyRow(ctx);
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			await ctx.db
				.updateTable('appointments')
				.set({
					calendar_revision: 2,
					video_chat: 'sip:selected@example.com',
					video_chat_request: 'suppress'
				})
				.where('id', '=', 'a')
				.execute();
			return new Response(null, { status: 201 });
		});

		await reconcileAppointment(ctx, snapshot);

		const afterPush = await rowById(ctx.db, 'a');
		expect(afterPush.external_calendar_id).toBe('work');
		expect(afterPush.external_event_id).toBe('a');
		expect(afterPush.calendar_revision).toBe(2);
		expect(afterPush.calendar_synced_revision).toBeNull();
		expect(afterPush.video_chat).toBe('sip:selected@example.com');
		expect(afterPush.video_chat_request).toBe('suppress');

		let published = '';
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
			published = String(init?.body);
			return new Response(null, { status: 204 });
		});
		await reconcileAppointment(ctx, afterPush);
		const afterRepair = await rowById(ctx.db, 'a');
		expect(afterRepair.calendar_synced_revision).toBe(2);
		expect(published).toContain('sip:selected@example.com');
		expect(afterRepair.video_chat).toBe('sip:selected@example.com');
	} finally {
		await ctx.db.destroy();
	}
});

test.each(['binding', 'purged'] as const)(
	'a completed push does not claim a concurrently changed %s',
	async (change) => {
		const ctx = await ctxWith();
		try {
			await insert(ctx, { calendar_revision: 1 });
			const snapshot = await onlyRow(ctx);
			vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
				await ctx.db
					.updateTable('appointments')
					.set(
						change === 'binding'
							? { external_event_id: 'new-event', external_calendar_id: 'new-calendar' }
							: { status: 'purged' }
					)
					.where('id', '=', 'a')
					.execute();
				return new Response(null, { status: 201 });
			});

			await reconcileAppointment(ctx, snapshot);

			const current = await rowById(ctx.db, 'a');
			expect(current.calendar_synced_revision).toBeNull();
			if (change === 'binding') {
				expect(current.external_event_id).toBe('new-event');
				expect(current.external_calendar_id).toBe('new-calendar');
			} else {
				expect(current.status).toBe('purged');
			}
		} finally {
			await ctx.db.destroy();
		}
	}
);

test.each(['pending', 'confirmed'] as const)(
	'cancelled predecessors cannot delete or acknowledge removal of an event used by a %s successor',
	async (status) => {
		const ctx = await ctxWith();
		try {
			await insert(ctx, {
				id: 'old',
				status: 'cancelled',
				calendar_revision: 2,
				external_event_id: 'shared',
				external_calendar_id: 'work'
			});
			await insert(ctx, {
				id: 'new',
				cancel_token: 'new',
				start_time: '2026-05-02T10:00:00Z',
				status,
				external_event_id: 'shared',
				external_calendar_id: 'work'
			});
			const { calls } = recordingFetch();
			const snapshot = await rowById(ctx.db, 'old');

			await reconcileAppointment(ctx, snapshot);

			const current = await rowById(ctx.db, 'old');
			const states = await calendarJobStates(ctx.db, 'old');
			expect(calls).toEqual([]);
			expect(current.external_event_id).toBe('shared');
			expect(current.external_calendar_id).toBe('work');
			expect(current.calendar_synced_revision).toBeNull();
			expect(states).toEqual([]);
		} finally {
			await ctx.db.destroy();
		}
	}
);

test.each(['revision', 'binding'] as const)(
	'a completed deletion cannot clear a concurrently changed %s',
	async (change) => {
		const ctx = await ctxWith();
		try {
			await insert(ctx, {
				status: 'cancelled',
				calendar_revision: 2,
				external_event_id: 'old',
				external_calendar_id: 'work',
				video_chat: 'sip:selected@example.com'
			});
			const snapshot = await onlyRow(ctx);
			vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
				expect(init?.method).toBe('DELETE');
				await ctx.db
					.updateTable('appointments')
					.set(
						change === 'revision'
							? { calendar_revision: 3 }
							: { external_event_id: 'new', external_calendar_id: 'new-calendar' }
					)
					.where('id', '=', 'a')
					.execute();
				return new Response(null, { status: 204 });
			});

			await reconcileAppointment(ctx, snapshot);

			const current = await rowById(ctx.db, 'a');
			expect(current.calendar_synced_revision).toBeNull();
			expect(current.external_event_id).toBe(change === 'revision' ? 'old' : 'new');
			expect(current.external_calendar_id).toBe(change === 'revision' ? 'work' : 'new-calendar');
			expect(current.video_chat).toBe('sip:selected@example.com');
		} finally {
			await ctx.db.destroy();
		}
	}
);

test('a stale cancelled snapshot cannot delete an event after reconfirmation', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, {
			status: 'cancelled',
			calendar_revision: 2,
			external_event_id: 'event',
			external_calendar_id: 'work'
		});
		const snapshot = await onlyRow(ctx);
		await ctx.db
			.updateTable('appointments')
			.set({ status: 'confirmed', calendar_revision: 3 })
			.where('id', '=', 'a')
			.execute();
		const { calls } = recordingFetch();

		await reconcileAppointment(ctx, snapshot);

		const current = await rowById(ctx.db, 'a');
		expect(calls).toEqual([]);
		expect(current.external_event_id).toBe('event');
		expect(current.calendar_synced_revision).toBeNull();
	} finally {
		await ctx.db.destroy();
	}
});

test('scan skips a controlled cleanup failure, leaves it dirty, and cleans before publishing following rows', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { id: 'first', calendar_revision: 1 });
		await insert(ctx, {
			id: 'second',
			cancel_token: 'second',
			start_time: '2026-05-02T10:00:00Z',
			calendar_revision: 1
		});
		const order: string[] = [];
		vi.mocked(cleanupAppointmentVideoChat).mockImplementation(async (_ctx, id) => {
			order.push(`cleanup:${id}`);
			return id !== 'first';
		});
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			order.push(`publish:${String(url).split('/').at(-1)}`);
			return new Response(null, { status: 201 });
		});

		await scanOnce(ctx);

		const first = await rowById(ctx.db, 'first');
		const second = await rowById(ctx.db, 'second');
		expect(first.calendar_synced_revision).toBeNull();
		expect(first.external_event_id).toBeNull();
		expect(second.calendar_synced_revision).toBe(1);
		expect(order).toEqual(['cleanup:first', 'cleanup:second', 'publish:second.ics']);
	} finally {
		await ctx.db.destroy();
	}
});

test('unexpected cleanup errors escape the scan instead of being acknowledged', async () => {
	const ctx = await ctxWith();
	try {
		await insert(ctx, { calendar_revision: 1 });
		vi.mocked(cleanupAppointmentVideoChat).mockRejectedValue(new Error('database failed'));
		const { calls } = recordingFetch();

		const scan = scanOnce(ctx);

		await expect(scan).rejects.toThrow('database failed');
		const current = await rowById(ctx.db, 'a');
		expect(current.calendar_synced_revision).toBeNull();
		expect(calls).toEqual([]);
	} finally {
		await ctx.db.destroy();
	}
});
