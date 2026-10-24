import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { sql } from 'kysely';
import {
	openDb,
	parseActionLog,
	replaceCalendarBusy,
	runMigrations,
	withWriteTransaction,
	type Appointment,
	type NewAppointment
} from '@when/db';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import { changeAppointmentDuration } from './change-duration';
import { editAppointment } from './edit';
import type { AppointmentContext } from './context';

vi.mock('../workflow', () => ({ enqueueAppointmentReconciliation: vi.fn() }));
import { enqueueAppointmentReconciliation } from '../workflow';

const start = '2099-01-04T15:07:00Z';
const initialHistory = [{ action: 'create', actor: 'guest', at: '2098-12-01T12:00:00Z' }];
const baseRow: NewAppointment = {
	id: 'duration',
	event_type_id: '30-min-chat',
	start_time: start,
	end_time: '2099-01-04T15:37:00Z',
	status: 'confirmed',
	cancel_token: 'unchanged-token',
	origin_id: 'original-appointment',
	guest_name: 'Guest',
	guest_email: 'guest@example.com',
	guest_timezone: 'Pacific/Auckland',
	guest_answers: JSON.stringify({ goals: 'Keep these answers' }),
	location: 'Existing location',
	note: 'Existing note',
	video_chat: 'https://video.example/keep',
	video_chat_request: 'generate',
	external_event_id: 'published-event',
	external_calendar_id: 'my-google-cal',
	calendar_revision: 7,
	calendar_synced_revision: 7,
	ics_sequence: 4,
	has_possible_conflict: 1,
	meeting_snapshot: JSON.stringify(validConfig.meetings['30-min-chat']),
	action_log: JSON.stringify(initialHistory),
	created_at: '2098-12-01 12:00:00',
	updated_at: '2098-12-01 12:00:00'
};

let db: ReturnType<typeof openDb>;
let cfg: typeof validConfig;
let now: string;
let statements: string[];

function context(): AppointmentContext {
	return { db, cfg, clock: { now: () => new Date(now), nowMs: () => Date.parse(now) } };
}

async function seed(changes: Partial<NewAppointment> = {}) {
	await db
		.insertInto('appointments')
		.values({ ...baseRow, ...changes })
		.execute();
}

async function row(id = baseRow.id) {
	const saved = await db
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', id)
		.executeTakeFirstOrThrow();
	return saved;
}

async function change(durationMinutes: number) {
	const result = await changeAppointmentDuration(context(), {
		appointmentId: baseRow.id,
		durationMinutes
	});
	return result;
}

async function expectUnwritten(before: Appointment) {
	const saved = await row();
	expect(saved).toEqual(before);
	expect(enqueueAppointmentReconciliation).not.toHaveBeenCalled();
}

beforeEach(async () => {
	const root = openDb(':memory:');
	await runMigrations(root);
	statements = [];
	db = root.withPlugin({
		transformQuery({ node, queryId }) {
			statements.push(root.getExecutor().compileQuery(node, queryId).sql);
			return node;
		},
		async transformResult({ result }) {
			return result;
		}
	});
	cfg = structuredClone(validConfig);
	now = '2099-01-04T14:00:00Z';
	vi.mocked(enqueueAppointmentReconciliation).mockReset();
	vi.mocked(enqueueAppointmentReconciliation).mockResolvedValue(undefined);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await db.destroy();
});

describe('changeAppointmentDuration: one in-place host edit', () => {
	test.each([
		{ status: 'pending', video_chat_request: null },
		{ status: 'pending', video_chat_request: 'generate' },
		{ status: 'pending', video_chat_request: 'suppress' },
		{ status: 'confirmed', video_chat_request: null },
		{ status: 'confirmed', video_chat_request: 'generate' },
		{ status: 'confirmed', video_chat_request: 'suppress' }
	] as const)(
		'preserves every non-duration field for $status / $video_chat_request',
		async (fields) => {
			await seed(fields);
			const before = await row();
			const result = await change(60);
			const saved = await row();

			expect(result).toEqual({ ok: true, outcome: 'updated', appointment: saved });
			expect(saved).toEqual({
				...before,
				end_time: '2099-01-04T16:07:00Z',
				calendar_revision: before.calendar_revision + 1,
				ics_sequence: before.ics_sequence + 1,
				updated_at: saved.updated_at,
				action_log: saved.action_log
			});
			expect(saved.updated_at).not.toBe(before.updated_at);
			expect(parseActionLog(saved.action_log)).toEqual([
				...initialHistory,
				{
					action: 'edit',
					actor: 'host',
					at: new Date(now).toISOString(),
					payload: {
						metadata: { changes: ['duration_updated'], previous_duration: 30, duration: 60 }
					}
				}
			]);
			const appointments = await db.selectFrom('appointments').selectAll().execute();
			expect(appointments).toEqual([saved]);
			expect(enqueueAppointmentReconciliation).toHaveBeenCalledExactlyOnceWith(
				saved,
				'edited-by-host'
			);
		}
	);

	test.each([15, 45, 60, 90, 120, 180, 240, 300])(
		'accepts application host choice %i as total minutes from the original start',
		async (duration) => {
			await seed();
			const result = await change(duration);
			const saved = await row();
			expect(result).toEqual({ ok: true, outcome: 'updated', appointment: saved });
			expect(saved.start_time).toBe(start);
			expect(saved.end_time).toBe(
				Temporal.Instant.from(start).add({ minutes: duration }).toString()
			);
		}
	);

	test.each([20, 40, 75, 360])(
		'accepts configured extra/default %i outside the application choices',
		async (duration) => {
			cfg.meetings['30-min-chat'].duration_minutes = 40;
			cfg.meetings['30-min-chat'].additional_duration_minutes = [20, 75, 360];
			await seed();
			const result = await change(duration);
			expect(result).toMatchObject({ ok: true, outcome: 'updated' });
			const saved = await row();
			expect(saved.end_time).toBe(
				Temporal.Instant.from(start).add({ minutes: duration }).toString()
			);
		}
	);

	test.each([30, 85])(
		'keeping current %i minutes performs no write, conflict read, history append or enqueue',
		async (duration) => {
			await seed({ end_time: Temporal.Instant.from(start).add({ minutes: duration }).toString() });
			await replaceCalendarBusy(db, 'my-google-cal', [{ start, end: '2099-01-04T20:00:00Z' }]);
			const before = await row();
			statements.length = 0;
			const result = await change(duration);

			expect(result).toEqual({ ok: true, outcome: 'unchanged', appointment: before });
			expect(statements).toEqual([
				'BEGIN IMMEDIATE',
				'select * from "appointments" where "id" = ?',
				'COMMIT'
			]);
			await expectUnwritten(before);
		}
	);

	test('rereads the current row instead of overwriting newer omitted fields or using stale duration', async () => {
		await seed();
		const page = await row();
		await db
			.updateTable('appointments')
			.set({
				end_time: '2099-01-04T16:32:00Z',
				note: 'Newer note',
				location: 'Newer location',
				video_chat: 'https://video.example/newer',
				video_chat_request: 'suppress',
				guest_answers: '{"new":"answer"}',
				external_event_id: 'newer-reference',
				calendar_revision: 9,
				ics_sequence: 6
			})
			.where('id', '=', page.id)
			.execute();
		const fresh = await row();
		const result = await change(60);
		const saved = await row();
		expect(result).toEqual({ ok: true, outcome: 'updated', appointment: saved });
		expect(saved).toEqual({
			...fresh,
			end_time: '2099-01-04T16:07:00Z',
			calendar_revision: 10,
			ics_sequence: 7,
			action_log: saved.action_log,
			updated_at: saved.updated_at
		});
		expect(parseActionLog(saved.action_log).at(-1)?.payload?.metadata).toEqual({
			changes: ['duration_updated'],
			previous_duration: 85,
			duration: 60
		});
	});

	test('concurrent identical saves serialize to one update and one unchanged result, not two revisions', async () => {
		await seed();
		const results = await Promise.all([change(60), change(60)]);
		expect(results.map((result) => result.ok && result.outcome).sort()).toEqual([
			'unchanged',
			'updated'
		]);
		const saved = await row();
		expect(saved).toMatchObject({
			end_time: '2099-01-04T16:07:00Z',
			calendar_revision: 8,
			ics_sequence: 5
		});
		expect(parseActionLog(saved.action_log)).toHaveLength(2);
		expect(enqueueAppointmentReconciliation).toHaveBeenCalledExactlyOnceWith(
			saved,
			'edited-by-host'
		);
	});

	test('concurrent duration and existing partial content edit both survive with one revision each', async () => {
		await seed();
		const ctx = context();
		const results = await Promise.all([
			changeAppointmentDuration(ctx, { appointmentId: baseRow.id, durationMinutes: 60 }),
			editAppointment(ctx, {
				appointmentId: baseRow.id,
				note: 'Concurrent note',
				location: 'Concurrent location'
			})
		]);
		expect(results.every((result) => result.ok)).toBe(true);
		const saved = await row();
		expect(saved).toMatchObject({
			note: 'Concurrent note',
			location: 'Concurrent location',
			end_time: '2099-01-04T16:07:00Z',
			calendar_revision: 9,
			ics_sequence: 6,
			video_chat: baseRow.video_chat,
			video_chat_request: 'generate'
		});
		const history = parseActionLog(saved.action_log);
		expect(history).toHaveLength(3);
		expect(history.slice(1).map((entry) => entry.payload?.metadata?.changes)).toEqual(
			expect.arrayContaining([['duration_updated'], ['note_updated', 'location_updated']])
		);
		expect(enqueueAppointmentReconciliation).toHaveBeenCalledTimes(2);
	});
});

describe('changeAppointmentDuration: bounded refusals', () => {
	test('missing ID returns not_found', async () => {
		const result = await change(60);
		expect(result).toEqual({ ok: false, reason: 'not_found' });
		expect(enqueueAppointmentReconciliation).not.toHaveBeenCalled();
	});

	test.each(['declined', 'cancelled', 'expired', 'rescheduled', 'purged'] as const)(
		'gates a freshly changed %s row',
		async (status) => {
			await seed();
			const page = await row();
			await db.updateTable('appointments').set({ status }).where('id', '=', page.id).execute();
			const before = await row();
			const result = await change(60);
			expect(result).toEqual({ ok: false, reason: 'gated' });
			await expectUnwritten(before);
		}
	);

	test.each(['2099-01-04T15:37:00Z', '2099-01-04T15:38:00Z'])(
		'gates at/after current end (%s), even when extending',
		async (time) => {
			await seed();
			now = time;
			const before = await row();
			const result = await change(60);
			expect(result).toEqual({ ok: false, reason: 'gated' });
			await expectUnwritten(before);
		}
	);

	test('requires live meeting config, not the stored meeting snapshot, even for unchanged duration', async () => {
		await seed();
		delete cfg.meetings['30-min-chat'];
		const before = await row();
		const result = await change(30);
		expect(result).toEqual({ ok: false, reason: 'not_configured' });
		await expectUnwritten(before);
	});

	test.each([0, -15, 16, 85, 15.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
		'rejects invalid/unoffered %s without changing the row',
		async (duration) => {
			await seed();
			const before = await row();
			const result = await change(duration);
			expect(result).toEqual({ ok: false, reason: 'invalid_duration' });
			await expectUnwritten(before);
		}
	);

	test('still requires a safe integer if a malformed config happens to offer a fraction', async () => {
		cfg.meetings['30-min-chat'].additional_duration_minutes = [22.5];
		await seed();
		const before = await row();
		const result = await change(22.5);
		expect(result).toEqual({ ok: false, reason: 'invalid_duration' });
		await expectUnwritten(before);
	});

	test.each(['2099-01-04T15:22:00Z', '2099-01-04T15:27:00Z'])(
		'rejects shortening to an end at/before now %s',
		async (time) => {
			await seed();
			now = time;
			const before = await row();
			const result = await change(15);
			expect(result).toEqual({ ok: false, reason: 'past_end' });
			await expectUnwritten(before);
		}
	);
});

describe('changeAppointmentDuration: active until current end; only actual conflicts constrain host', () => {
	test.each([
		['pending', 30, 60],
		['confirmed', 30, 60],
		['pending', 60, 30],
		['confirmed', 60, 30]
	] as const)(
		'allows in-progress %s, %i to %i minutes with a future new end',
		async (status, current, duration) => {
			await seed({
				status,
				end_time: Temporal.Instant.from(start).add({ minutes: current }).toString()
			});
			now = '2099-01-04T15:27:00Z';
			const result = await change(duration);
			expect(result).toMatchObject({ ok: true, outcome: 'updated' });
			const saved = await row();
			expect(saved).toMatchObject({
				status,
				start_time: start,
				end_time: Temporal.Instant.from(start).add({ minutes: duration }).toString()
			});
		}
	);

	test('allows an edit exactly at the appointment start', async () => {
		await seed();
		now = start;
		const result = await change(60);
		expect(result).toMatchObject({ ok: true, outcome: 'updated' });
	});

	test.each(['2099-01-04T15:06:00Z', '2098-01-01T00:00:00Z'])(
		'ignores working hours, off-grid start, notice, horizon, cap and padding when actually free (%s)',
		async (time) => {
			cfg.schedules.standard.weekly = [];
			Object.assign(cfg.meetings['30-min-chat'], {
				start_times_every_minutes: 60,
				notice_minutes: 10080,
				booking_window_days: 1,
				daily_booking_limit: 1,
				padding_before_minutes: 180,
				padding_after_minutes: 180
			});
			now = time;
			await seed();
			await seed({
				id: 'neighbour',
				cancel_token: 'neighbour-token',
				start_time: '2099-01-04T16:07:00Z',
				end_time: '2099-01-04T16:37:00Z'
			});
			await replaceCalendarBusy(db, 'my-google-cal', [
				{ start: '2099-01-04T14:07:00Z', end: start }
			]);
			const result = await change(60);
			expect(result).toMatchObject({ ok: true, outcome: 'updated' });
		}
	);

	test.each([
		{
			status: 'pending',
			event_type_id: '30-min-chat',
			start_time: '2099-01-04T15:50:00Z',
			end_time: '2099-01-04T16:30:00Z'
		},
		{
			status: 'confirmed',
			event_type_id: 'different-type',
			start_time: '2099-01-04T15:50:00Z',
			end_time: '2099-01-04T16:30:00Z'
		},
		{
			status: 'confirmed',
			event_type_id: 'removed-type',
			start_time: '2099-01-01T16:00:00Z',
			end_time: '2099-01-04T16:00:00Z'
		}
	] as const)('refuses hard local conflict $status / $event_type_id', async (fields) => {
		await seed();
		await seed({ ...fields, id: 'blocker', cancel_token: 'blocker-token' });
		const before = await row();
		const result = await change(60);
		expect(result).toEqual({ ok: false, reason: 'busy' });
		await expectUnwritten(before);
	});

	test.each(['my-google-cal', 'extra'])(
		'refuses mirrored busy in selected calendar %s',
		async (calendar) => {
			cfg.meetings['30-min-chat'].additional_busy_calendars = ['extra'];
			await seed();
			await replaceCalendarBusy(db, calendar, [
				{ start: '2099-01-04T15:50:00Z', end: '2099-01-04T16:30:00Z' }
			]);
			const before = await row();
			const result = await change(60);
			expect(result).toEqual({ ok: false, reason: 'busy' });
			await expectUnwritten(before);
		}
	);

	test('shortening uses the new interval, not busy time beyond its end or unselected calendars', async () => {
		await seed({ end_time: '2099-01-04T16:07:00Z' });
		await replaceCalendarBusy(db, 'my-google-cal', [
			{ start: '2099-01-04T15:37:00Z', end: '2099-01-04T16:07:00Z' }
		]);
		await replaceCalendarBusy(db, 'not-selected', [{ start, end: '2099-01-04T16:07:00Z' }]);
		const result = await change(30);
		expect(result).toMatchObject({ ok: true, outcome: 'updated' });
	});
});

describe('changeAppointmentDuration: transaction and enqueue boundary', () => {
	test('fresh read, actual conflict reads and update share one BEGIN IMMEDIATE before commit and enqueue', async () => {
		await seed();
		const rootRead = vi.spyOn(db, 'selectFrom').mockImplementation(() => {
			throw new Error('must read on reserved connection');
		});
		const rootUpdate = vi.spyOn(db, 'updateTable').mockImplementation(() => {
			throw new Error('must update on reserved connection');
		});
		const rootConnection = vi.spyOn(db, 'connection');
		statements.length = 0;
		let committedAtEnqueue: Appointment | undefined;
		vi.mocked(enqueueAppointmentReconciliation).mockImplementationOnce(async () => {
			expect(statements.at(-1)).toBe('COMMIT');
			expect(rootConnection).toHaveBeenCalledTimes(1);
			await withWriteTransaction(db, async (connection) => {
				committedAtEnqueue = await connection
					.selectFrom('appointments')
					.selectAll()
					.where('id', '=', baseRow.id)
					.executeTakeFirstOrThrow();
			});
		});
		const result = await change(60);
		expect(result).toEqual({ ok: true, outcome: 'updated', appointment: committedAtEnqueue });
		expect(
			statements.slice(0, 6).map((statement) => {
				if (statement.startsWith('update')) return 'update';
				if (statement.includes('"external_calendar_busy"')) return 'mirror conflict read';
				if (statement.startsWith('select "start_time"')) return 'local conflict read';
				if (statement.startsWith('select *')) return 'fresh row read';
				return statement;
			})
		).toEqual([
			'BEGIN IMMEDIATE',
			'fresh row read',
			'local conflict read',
			'mirror conflict read',
			'update',
			'COMMIT'
		]);
		expect(rootRead).not.toHaveBeenCalled();
		expect(rootUpdate).not.toHaveBeenCalled();
		expect(committedAtEnqueue).toMatchObject({
			end_time: '2099-01-04T16:07:00Z',
			calendar_revision: 8,
			ics_sequence: 5
		});
	});

	test('SQLite update failure escapes, rolls back and is not mislabeled as enqueue failure', async () => {
		await seed();
		const before = await row();
		await sql`CREATE TRIGGER reject_duration BEFORE UPDATE ON appointments BEGIN SELECT RAISE(ABORT, 'injected duration write failure'); END`.execute(
			db
		);
		const write = change(60);
		await expect(write).rejects.toThrow('injected duration write failure');
		await expectUnwritten(before);
		expect(statements).toContain('ROLLBACK');
		await sql`DROP TRIGGER reject_duration`.execute(db);
		const retried = await change(60);
		expect(retried).toMatchObject({ ok: true, outcome: 'updated' });
	});

	test('enqueue rejection reports the actual committed save; an unchanged retry neither reenqueues nor claims recovery', async () => {
		await seed();
		vi.mocked(enqueueAppointmentReconciliation).mockImplementationOnce(async () => {
			await withWriteTransaction(db, async (connection) => {
				const committed = await connection
					.selectFrom('appointments')
					.selectAll()
					.where('id', '=', baseRow.id)
					.executeTakeFirstOrThrow();
				expect(committed).toMatchObject({
					end_time: '2099-01-04T16:07:00Z',
					calendar_revision: 8,
					ics_sequence: 5
				});
			});
			throw new Error('queue unavailable');
		});
		const failed = await change(60);
		const saved = await row();
		expect(failed).toEqual({ ok: false, reason: 'enqueue_failed', durationSaved: true });
		expect(parseActionLog(saved.action_log)).toHaveLength(2);
		const retry = await change(60);
		const afterRetry = await row();
		expect(retry).toEqual({ ok: true, outcome: 'unchanged', appointment: saved });
		expect(afterRetry).toEqual(saved);
		expect(enqueueAppointmentReconciliation).toHaveBeenCalledExactlyOnceWith(
			saved,
			'edited-by-host'
		);
	});
});
