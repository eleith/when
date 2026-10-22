import { beforeEach, describe, expect, test, vi } from 'vitest';
import { classifyReschedule, rescheduleAppointment } from './reschedule';
import { systemClock } from '$lib/server/clock';
import {
	openDb,
	runMigrations,
	parseActionLog,
	type ActionLogEntry,
	type Appointment
} from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('../workflow', () => ({ enqueueAppointmentReconciliation: vi.fn() }));
import { enqueueAppointmentReconciliation } from '../workflow';

const now = new Date('2026-05-01T13:00:00Z');

const existing: Appointment = {
	id: 'appt-1',
	event_type_id: 'chat',
	start_time: '2026-05-01T15:00:00Z',
	end_time: '2026-05-01T15:30:00Z',
	guest_name: 'Booker',
	guest_email: 'booker@example.com',
	guest_answers: null,
	guest_timezone: null,
	location: null,
	note: null,
	video_chat: null,
	video_chat_request: null,
	status: 'confirmed',
	origin_id: 'appt-1',
	cancel_token: 'tok-good',
	action_log: null,
	external_event_id: null,
	external_calendar_id: null,
	calendar_revision: 0,
	calendar_synced_revision: null,
	has_possible_conflict: 0,
	ics_sequence: 0,
	meeting_snapshot: null,
	created_at: '',
	updated_at: ''
};

const eventType = { notice_minutes: 60 };

describe('classifyReschedule', () => {
	test('fresh when no rescheduleId', () => {
		expect(
			classifyReschedule({
				rescheduleId: null,
				token: null,
				existing: undefined,
				slug: 'chat',
				eventType,
				now
			})
		).toEqual({ kind: 'fresh' });
	});

	test('reschedule on the happy path', () => {
		const ctx = classifyReschedule({
			rescheduleId: 'appt-1',
			token: 'tok-good',
			existing,
			slug: 'chat',
			eventType,
			now
		});
		expect(ctx).toEqual({
			kind: 'reschedule'
		});
	});

	test('token error when row is missing', () => {
		expect(
			classifyReschedule({
				rescheduleId: 'appt-1',
				token: 'tok-good',
				existing: undefined,
				slug: 'chat',
				eventType,
				now
			})
		).toEqual({ kind: 'error', code: 'token' });
	});

	test('token error on token mismatch', () => {
		expect(
			classifyReschedule({
				rescheduleId: 'appt-1',
				token: 'tok-bad',
				existing,
				slug: 'chat',
				eventType,
				now
			})
		).toEqual({ kind: 'error', code: 'token' });
	});

	test('token error when token is missing but rescheduleId present', () => {
		expect(
			classifyReschedule({
				rescheduleId: 'appt-1',
				token: null,
				existing,
				slug: 'chat',
				eventType,
				now
			})
		).toEqual({ kind: 'error', code: 'token' });
	});

	test('event_type error when slug points at the wrong event type', () => {
		expect(
			classifyReschedule({
				rescheduleId: 'appt-1',
				token: 'tok-good',
				existing,
				slug: 'other',
				eventType,
				now
			})
		).toEqual({ kind: 'error', code: 'event_type' });
	});

	test('past_window when now is past end_time + 14 days', () => {
		const past = new Date('2026-05-16T00:00:00Z'); // > end + 14d
		expect(
			classifyReschedule({
				rescheduleId: 'appt-1',
				token: 'tok-good',
				existing,
				slug: 'chat',
				eventType,
				now: past
			})
		).toEqual({ kind: 'error', code: 'past_window' });
	});

	test('terminal when status is cancelled', () => {
		expect(
			classifyReschedule({
				rescheduleId: 'appt-1',
				token: 'tok-good',
				existing: { ...existing, status: 'cancelled' },
				slug: 'chat',
				eventType,
				now
			})
		).toEqual({ kind: 'error', code: 'terminal' });
	});

	test('terminal when status is declined', () => {
		expect(
			classifyReschedule({
				rescheduleId: 'appt-1',
				token: 'tok-good',
				existing: { ...existing, status: 'declined' },
				slug: 'chat',
				eventType,
				now
			})
		).toEqual({ kind: 'error', code: 'terminal' });
	});

	test('minimum_notice error when within notice window', () => {
		const close = new Date('2026-05-01T14:30:00Z'); // 30 min before start, notice 60
		expect(
			classifyReschedule({
				rescheduleId: 'appt-1',
				token: 'tok-good',
				existing,
				slug: 'chat',
				eventType,
				now: close
			})
		).toEqual({ kind: 'error', code: 'minimum_notice' });
	});

	test('minimum_notice covers post-start clock as well', () => {
		const after = new Date('2026-05-01T15:10:00Z'); // after start_time
		expect(
			classifyReschedule({
				rescheduleId: 'appt-1',
				token: 'tok-good',
				existing,
				slug: 'chat',
				eventType,
				now: after
			})
		).toEqual({ kind: 'error', code: 'minimum_notice' });
	});

	test('zero minimum notice allows a reschedule right up to the start', () => {
		const justBeforeStart = new Date('2026-05-01T14:59:00Z');
		expect(
			classifyReschedule({
				rescheduleId: 'appt-1',
				token: 'tok-good',
				existing,
				slug: 'chat',
				eventType: { notice_minutes: 0 },
				now: justBeforeStart
			})
		).toEqual({
			kind: 'reschedule'
		});
	});
});

const opBaseRow = {
	event_type_id: '30-min-chat',
	start_time: '2099-01-01T15:00:00Z',
	end_time: '2099-01-01T15:30:00Z',
	guest_name: 'Booker',
	guest_email: 'booker@example.com',
	guest_answers: null,
	guest_timezone: null,
	location: null,
	note: null,
	video_chat: null,
	external_event_id: null,
	external_calendar_id: null,
	calendar_revision: 0,
	calendar_synced_revision: null,
	has_possible_conflict: 0,
	ics_sequence: 0,
	meeting_snapshot: null,
	created_at: '',
	updated_at: ''
};

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

async function fetchRow(db: Awaited<ReturnType<typeof makeDb>>, id: string) {
	const row = await db
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', id)
		.executeTakeFirstOrThrow();
	return row;
}

describe('rescheduleAppointment', () => {
	beforeEach(() => {
		vi.mocked(enqueueAppointmentReconciliation).mockReset();
		vi.mocked(enqueueAppointmentReconciliation).mockResolvedValue(undefined);
	});

	test('happy path: creates a linked new row, ends the old one, queues a calendar sync', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...opBaseRow, id: 'r1', status: 'confirmed', cancel_token: 't1' })
				.execute();
			const row = await fetchRow(db, 'r1');

			const result = await rescheduleAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{
					appointmentId: row.id,
					initiator: 'guest',
					newStart: '2099-01-02T10:00:00Z',
					newEnd: '2099-01-02T10:30:00Z'
				}
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				const next = result.appointment;
				expect(next.id).not.toBe('r1');
				expect(next.start_time).toBe('2099-01-02T10:00:00Z');
				expect(next.end_time).toBe('2099-01-02T10:30:00Z');
				expect(next.status).toBe('confirmed');
				expect(next.ics_sequence).toBe(1);
				expect(next.origin_id).toBe('r1');
				expect(next.cancel_token).not.toBe('t1');

				const old = await fetchRow(db, 'r1');
				expect(old.status).toBe('rescheduled');

				expect(enqueueAppointmentReconciliation).toHaveBeenCalledWith(next, 'rescheduled-by-guest');
			}
		} finally {
			await db.destroy();
		}
	});

	test('guest re-collect: the new row takes the re-submitted form values', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...opBaseRow, id: 'r1', status: 'confirmed', cancel_token: 't1' })
				.execute();
			const row = await fetchRow(db, 'r1');

			const result = await rescheduleAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{
					appointmentId: row.id,
					initiator: 'guest',
					newStart: '2099-01-02T10:00:00Z',
					newEnd: '2099-01-02T10:30:00Z',
					guest: {
						name: 'Booker Renamed',
						email: null,
						location: 'Room B',
						answers: [{ name: 'why', label: 'Why move?', type: 'text', value: 'conflict' }]
					},
					timezone: 'Europe/London'
				}
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				const next = result.appointment;
				expect(next.guest_name).toBe('Booker Renamed');
				expect(next.guest_email).toBeNull();
				expect(next.location).toBe('Room B');
				expect(next.guest_timezone).toBe('Europe/London');
				expect(next.guest_answers).toBe(
					JSON.stringify([{ name: 'why', label: 'Why move?', type: 'text', value: 'conflict' }])
				);
			}
		} finally {
			await db.destroy();
		}
	});

	test('host reschedule with no override carries the old values forward', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					...opBaseRow,
					id: 'r1',
					status: 'confirmed',
					cancel_token: 't1',
					guest_name: 'Original',
					guest_email: 'orig@example.com',
					guest_answers: JSON.stringify([{ id: 'q', label: 'Q', type: 'text', value: 'kept' }])
				})
				.execute();
			const row = await fetchRow(db, 'r1');

			const result = await rescheduleAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{
					appointmentId: row.id,
					initiator: 'host',
					newStart: '2099-01-02T10:00:00Z',
					newEnd: '2099-01-02T10:30:00Z'
				}
			);

			expect(result.ok && result.appointment.guest_name).toBe('Original');
			expect(result.ok && result.appointment.guest_email).toBe('orig@example.com');
			expect(result.ok && result.appointment.guest_answers).toBe(
				JSON.stringify([{ id: 'q', label: 'Q', type: 'text', value: 'kept' }])
			);
		} finally {
			await db.destroy();
		}
	});

	test('the new row inherits the calendar event pointer so the event is patched, not recreated', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					...opBaseRow,
					id: 'r5',
					status: 'confirmed',
					cancel_token: 't5',
					origin_id: 'r5',
					external_event_id: 'r5',
					external_calendar_id: 'work'
				})
				.execute();
			const row = await fetchRow(db, 'r5');

			const result = await rescheduleAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{
					appointmentId: row.id,
					initiator: 'host',
					newStart: '2099-03-02T10:00:00Z',
					newEnd: '2099-03-02T10:30:00Z'
				}
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.origin_id).toBe('r5');
				expect(result.appointment.external_event_id).toBe('r5');
				expect(result.appointment.external_calendar_id).toBe('work');
				expect(enqueueAppointmentReconciliation).toHaveBeenCalledWith(
					result.appointment,
					'rescheduled-by-host'
				);
			}
		} finally {
			await db.destroy();
		}
	});

	const reapprovalCfg: WhenConfiguration = {
		...validConfig,
		meetings: {
			'confirm-me': { ...validConfig.meetings['30-min-chat'], require_approval: true }
		}
	};

	test('guest moving a confirmed requires-confirmation appointment reverts to pending, keeps the event', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					...opBaseRow,
					id: 'rc1',
					event_type_id: 'confirm-me',
					status: 'confirmed',
					cancel_token: 'tc1',
					external_event_id: 'rc1',
					external_calendar_id: 'work'
				})
				.execute();
			const row = await fetchRow(db, 'rc1');

			const result = await rescheduleAppointment(
				{ db, cfg: reapprovalCfg, clock: systemClock },
				{
					appointmentId: row.id,
					initiator: 'guest',
					newStart: '2099-04-02T10:00:00Z',
					newEnd: '2099-04-02T10:30:00Z'
				}
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.status).toBe('pending');
				expect(result.appointment.external_event_id).toBe('rc1');
			}
		} finally {
			await db.destroy();
		}
	});

	test('host moving the same requires-confirmation appointment stays confirmed', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					...opBaseRow,
					id: 'rc2',
					event_type_id: 'confirm-me',
					status: 'confirmed',
					cancel_token: 'tc2'
				})
				.execute();
			const row = await fetchRow(db, 'rc2');

			const result = await rescheduleAppointment(
				{ db, cfg: reapprovalCfg, clock: systemClock },
				{
					appointmentId: row.id,
					initiator: 'host',
					newStart: '2099-04-03T10:00:00Z',
					newEnd: '2099-04-03T10:30:00Z'
				}
			);

			expect(result.ok).toBe(true);
			if (result.ok) expect(result.appointment.status).toBe('confirmed');
		} finally {
			await db.destroy();
		}
	});

	test('host moving a pending requires-confirmation appointment changes status to confirmed', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					...opBaseRow,
					id: 'rc3',
					event_type_id: 'confirm-me',
					status: 'pending',
					cancel_token: 'tc3'
				})
				.execute();
			const row = await fetchRow(db, 'rc3');

			const result = await rescheduleAppointment(
				{ db, cfg: reapprovalCfg, clock: systemClock },
				{
					appointmentId: row.id,
					initiator: 'host',
					newStart: '2099-04-03T10:00:00Z',
					newEnd: '2099-04-03T10:30:00Z'
				}
			);

			expect(result.ok).toBe(true);
			if (result.ok) expect(result.appointment.status).toBe('confirmed');
		} finally {
			await db.destroy();
		}
	});

	test('gated: cancelled appointment returns { ok: false, reason: gated }', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...opBaseRow, id: 'r2', status: 'cancelled', cancel_token: 't2' })
				.execute();
			const row = await fetchRow(db, 'r2');

			const result = await rescheduleAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{
					appointmentId: row.id,
					initiator: 'guest',
					newStart: '2099-01-02T10:00:00Z',
					newEnd: '2099-01-02T10:30:00Z'
				}
			);
			expect(result).toEqual({ ok: false, reason: 'gated' });
		} finally {
			await db.destroy();
		}
	});

	test('slot_taken: unique-index violation surfaces as slot_taken reason', async () => {
		const db = await makeDb();
		try {
			// Existing appointment we want to move
			await db
				.insertInto('appointments')
				.values({ ...opBaseRow, id: 'r3a', status: 'confirmed', cancel_token: 't3a' })
				.execute();
			// Conflicting active appointment in the target slot (same event_type, same start)
			await db
				.insertInto('appointments')
				.values({
					...opBaseRow,
					id: 'r3b',
					status: 'confirmed',
					cancel_token: 't3b',
					start_time: '2099-02-01T10:00:00Z',
					end_time: '2099-02-01T10:30:00Z'
				})
				.execute();
			const row = await fetchRow(db, 'r3a');

			const result = await rescheduleAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{
					appointmentId: row.id,
					initiator: 'guest',
					newStart: '2099-02-01T10:00:00Z',
					newEnd: '2099-02-01T10:30:00Z'
				}
			);
			expect(result).toEqual({ ok: false, reason: 'slot_taken' });

			// Original row unchanged
			const persisted = await fetchRow(db, 'r3a');
			expect(persisted).toEqual(row);
			const rows = await db.selectFrom('appointments').selectAll().execute();
			expect(rows).toHaveLength(2);
			expect(enqueueAppointmentReconciliation).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});

	test('gated: cancellation after the page was loaded prevents rescheduling', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...opBaseRow, id: 'r4', status: 'confirmed', cancel_token: 't4' })
				.execute();
			const row = await fetchRow(db, 'r4');

			// Concurrent cancel lands first
			await db
				.updateTable('appointments')
				.set({ status: 'cancelled' })
				.where('id', '=', 'r4')
				.execute();
			const before = await fetchRow(db, row.id);

			const result = await rescheduleAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{
					appointmentId: row.id,
					initiator: 'guest',
					newStart: '2099-01-02T10:00:00Z',
					newEnd: '2099-01-02T10:30:00Z'
				}
			);
			expect(result).toEqual({ ok: false, reason: 'gated' });
			const after = await fetchRow(db, row.id);
			expect(after).toEqual(before);
			const rows = await db.selectFrom('appointments').selectAll().execute();
			expect(rows).toHaveLength(1);
			expect(enqueueAppointmentReconciliation).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});

	test.each(['generate', 'suppress', null] as const)(
		'host reschedule inherits current fields and history with video request %s',
		async (request) => {
			const db = await makeDb();
			try {
				const created: ActionLogEntry = {
					action: 'create',
					actor: 'guest',
					at: '2026-04-30T12:00:00Z'
				};
				await db
					.insertInto('appointments')
					.values({
						...opBaseRow,
						id: 'fresh',
						status: 'confirmed',
						cancel_token: 'fresh-token',
						origin_id: 'root',
						note: 'Page note',
						video_chat: 'https://page.example/room',
						video_chat_request: 'generate',
						external_event_id: 'page-event',
						external_calendar_id: 'page-calendar',
						action_log: JSON.stringify([created])
					})
					.execute();
				const page = await fetchRow(db, 'fresh');
				const currentHistory: ActionLogEntry[] = [
					created,
					{
						action: 'edit',
						actor: 'host',
						at: '2026-05-01T12:00:00Z',
						payload: { metadata: { changes: ['note_updated', 'video_chat_updated'] } }
					}
				];
				const currentAnswers = JSON.stringify([
					{ name: 'topic', label: 'Topic', type: 'text', value: 'Current topic' }
				]);
				await db
					.updateTable('appointments')
					.set({
						note: 'Current host note',
						video_chat: 'https://current.example/room',
						video_chat_request: request,
						guest_name: 'Current guest',
						guest_email: 'current@example.com',
						guest_answers: currentAnswers,
						guest_timezone: 'Asia/Tokyo',
						location: 'Current room',
						ics_sequence: 5,
						calendar_revision: 8,
						calendar_synced_revision: 7,
						external_event_id: 'current-event',
						external_calendar_id: 'current-calendar',
						action_log: JSON.stringify(currentHistory)
					})
					.where('id', '=', page.id)
					.execute();
				const current = await fetchRow(db, page.id);

				const result = await rescheduleAppointment(
					{ db, cfg: validConfig, clock: { now: () => now, nowMs: () => now.getTime() } },
					{
						appointmentId: page.id,
						initiator: 'host',
						newStart: '2099-01-02T10:00:00Z',
						newEnd: '2099-01-02T10:30:00Z',
						reason: 'Moving our meeting'
					}
				);

				expect(result.ok).toBe(true);
				if (!result.ok) return;
				const next = await fetchRow(db, result.appointment.id);
				expect(result.appointment).toEqual(next);
				expect(next).toMatchObject({
					note: current.note,
					video_chat: current.video_chat,
					video_chat_request: request,
					guest_name: current.guest_name,
					guest_email: current.guest_email,
					guest_answers: currentAnswers,
					guest_timezone: current.guest_timezone,
					location: current.location,
					ics_sequence: 6,
					calendar_revision: 0,
					calendar_synced_revision: null,
					origin_id: 'root',
					external_event_id: 'current-event',
					external_calendar_id: 'current-calendar',
					status: 'confirmed',
					start_time: '2099-01-02T10:00:00Z',
					end_time: '2099-01-02T10:30:00Z'
				});
				expect(next.id).not.toBe(page.id);
				expect(next.cancel_token).not.toBe(page.cancel_token);
				const expectedHistory = [
					...currentHistory,
					{
						action: 'reschedule',
						actor: 'host',
						at: now.toISOString(),
						payload: {
							field: 'status',
							from: 'confirmed',
							to: 'rescheduled',
							note: 'Moving our meeting',
							metadata: { next_id: next.id, previous_id: page.id }
						}
					}
				];
				const old = await fetchRow(db, page.id);
				const nextHistory = parseActionLog(next.action_log);
				const oldHistory = parseActionLog(old.action_log);
				expect(nextHistory).toEqual(expectedHistory);
				expect(oldHistory).toEqual(expectedHistory);
				expect(old).toEqual({
					...current,
					status: 'rescheduled',
					action_log: next.action_log,
					updated_at: old.updated_at
				});
				expect(enqueueAppointmentReconciliation).toHaveBeenCalledTimes(1);
				expect(enqueueAppointmentReconciliation).toHaveBeenCalledWith(next, 'rescheduled-by-host');
			} finally {
				await db.destroy();
			}
		}
	);

	test.each([
		{ timezone: undefined, expected: 'Asia/Tokyo' },
		{ timezone: 'Europe/London', expected: 'Europe/London' }
	])(
		'guest clears form values and uses timezone $expected without losing current host fields',
		async ({ timezone, expected }) => {
			const db = await makeDb();
			try {
				await db
					.insertInto('appointments')
					.values({
						...opBaseRow,
						id: 'guest-clear',
						status: 'confirmed',
						cancel_token: 'guest-token',
						guest_timezone: 'America/New_York'
					})
					.execute();
				const page = await fetchRow(db, 'guest-clear');
				await db
					.updateTable('appointments')
					.set({
						note: 'Current host note',
						video_chat: 'https://current.example/room',
						video_chat_request: 'suppress',
						guest_name: 'Current guest',
						guest_email: 'current@example.com',
						location: 'Current room',
						guest_answers: JSON.stringify([
							{ name: 'topic', label: 'Topic', type: 'text', value: 'Current' }
						]),
						guest_timezone: 'Asia/Tokyo'
					})
					.where('id', '=', page.id)
					.execute();

				const result = await rescheduleAppointment(
					{ db, cfg: validConfig, clock: systemClock },
					{
						appointmentId: page.id,
						initiator: 'guest',
						newStart: '2099-01-02T10:00:00Z',
						newEnd: '2099-01-02T10:30:00Z',
						guest: { name: 'Submitted guest', email: null, location: null, answers: [] },
						timezone
					}
				);

				expect(result.ok).toBe(true);
				if (!result.ok) return;
				const next = await fetchRow(db, result.appointment.id);
				expect(next).toMatchObject({
					guest_name: 'Submitted guest',
					guest_email: null,
					location: null,
					guest_answers: null,
					guest_timezone: expected,
					note: 'Current host note',
					video_chat: 'https://current.example/room',
					video_chat_request: 'suppress'
				});
			} finally {
				await db.destroy();
			}
		}
	);

	test.each([
		{ requireApproval: false, expected: 'confirmed' },
		{ requireApproval: true, expected: 'pending' }
	])(
		'guest reschedule uses current acceptance with require_approval=$requireApproval',
		async ({ requireApproval, expected }) => {
			const db = await makeDb();
			try {
				const cfg: WhenConfiguration = {
					...validConfig,
					meetings: {
						'30-min-chat': {
							...validConfig.meetings['30-min-chat'],
							require_approval: requireApproval
						}
					}
				};
				await db
					.insertInto('appointments')
					.values({
						...opBaseRow,
						id: 'accepted',
						status: 'pending',
						cancel_token: 'accepted-token'
					})
					.execute();
				const page = await fetchRow(db, 'accepted');
				const acceptance: ActionLogEntry = {
					action: 'confirm',
					actor: 'host',
					at: '2026-05-01T12:00:00Z'
				};
				await db
					.updateTable('appointments')
					.set({ status: 'confirmed', action_log: JSON.stringify([acceptance]) })
					.where('id', '=', page.id)
					.execute();

				const result = await rescheduleAppointment(
					{ db, cfg, clock: systemClock },
					{
						appointmentId: page.id,
						initiator: 'guest',
						newStart: '2099-01-02T10:00:00Z',
						newEnd: '2099-01-02T10:30:00Z'
					}
				);

				expect(result.ok).toBe(true);
				if (!result.ok) return;
				expect(result.appointment.status).toBe(expected);
				const history = parseActionLog(result.appointment.action_log);
				expect(history).toHaveLength(2);
				expect(history[0]).toEqual(acceptance);
				expect(history[1]).toMatchObject({
					action: 'reschedule',
					actor: 'guest',
					payload: { from: 'confirmed', to: 'rescheduled' }
				});
			} finally {
				await db.destroy();
			}
		}
	);

	test.each([
		{ gate: 'minimum notice', start: '2026-05-01T13:30:00Z', end: '2026-05-01T14:00:00Z' },
		{ gate: 'past start', start: '2026-05-01T12:30:00Z', end: '2026-05-01T13:00:00Z' }
	])('gates the current $gate row without mutation or enqueue', async ({ start, end }) => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					...opBaseRow,
					id: 'fresh-gate',
					status: 'confirmed',
					cancel_token: 'gate-token'
				})
				.execute();
			const page = await fetchRow(db, 'fresh-gate');
			await db
				.updateTable('appointments')
				.set({ start_time: start, end_time: end })
				.where('id', '=', page.id)
				.execute();
			const before = await fetchRow(db, page.id);
			const clock = { now: () => now, nowMs: () => now.getTime() };

			const result = await rescheduleAppointment(
				{ db, cfg: validConfig, clock },
				{
					appointmentId: page.id,
					initiator: 'guest',
					newStart: '2099-01-02T10:00:00Z',
					newEnd: '2099-01-02T10:30:00Z'
				}
			);

			expect(result).toEqual({ ok: false, reason: 'gated' });
			const rows = await db.selectFrom('appointments').selectAll().execute();
			expect(rows).toEqual([before]);
			expect(enqueueAppointmentReconciliation).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});

	test('concurrent reschedules to different slots create only one successor and enqueue', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					...opBaseRow,
					id: 'concurrent',
					status: 'confirmed',
					cancel_token: 'concurrent-token'
				})
				.execute();
			const ctx = { db, cfg: validConfig, clock: systemClock };

			const results = await Promise.all([
				rescheduleAppointment(ctx, {
					appointmentId: 'concurrent',
					initiator: 'host',
					newStart: '2099-01-02T10:00:00Z',
					newEnd: '2099-01-02T10:30:00Z'
				}),
				rescheduleAppointment(ctx, {
					appointmentId: 'concurrent',
					initiator: 'host',
					newStart: '2099-01-03T10:00:00Z',
					newEnd: '2099-01-03T10:30:00Z'
				})
			]);

			const successes = results.filter((result) => result.ok);
			const failures = results.filter((result) => !result.ok);
			expect(successes).toHaveLength(1);
			expect(failures).toEqual([{ ok: false, reason: 'gated' }]);
			const rows = await db.selectFrom('appointments').selectAll().execute();
			expect(rows).toHaveLength(2);
			const original = await fetchRow(db, 'concurrent');
			expect(original.status).toBe('rescheduled');
			const successors = rows.filter((row) => row.id !== original.id);
			expect(successors).toHaveLength(1);
			const next = successors[0];
			expect(next).toMatchObject({ origin_id: original.id, status: 'confirmed' });
			expect(['2099-01-02T10:00:00Z', '2099-01-03T10:00:00Z']).toContain(next.start_time);
			expect(successes[0].appointment.id).toBe(next.id);
			const history = parseActionLog(next.action_log);
			expect(history).toHaveLength(1);
			expect(history[0]).toMatchObject({
				action: 'reschedule',
				payload: { metadata: { previous_id: original.id, next_id: next.id } }
			});
			expect(original.action_log).toBe(next.action_log);
			expect(enqueueAppointmentReconciliation).toHaveBeenCalledTimes(1);
			expect(enqueueAppointmentReconciliation).toHaveBeenCalledWith(next, 'rescheduled-by-host');
		} finally {
			await db.destroy();
		}
	});

	test('a missing appointment returns conflict without enqueue', async () => {
		const db = await makeDb();
		try {
			const result = await rescheduleAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{
					appointmentId: 'missing',
					initiator: 'guest',
					newStart: '2099-01-02T10:00:00Z',
					newEnd: '2099-01-02T10:30:00Z'
				}
			);
			expect(result).toEqual({ ok: false, reason: 'conflict' });
			const rows = await db.selectFrom('appointments').selectAll().execute();
			expect(rows).toEqual([]);
			expect(enqueueAppointmentReconciliation).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});
});
