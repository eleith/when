import { beforeEach, describe, expect, test, vi } from 'vitest';
import { classifyReschedule, rescheduleAppointment } from './reschedule';
import { systemClock } from '$lib/server/clock';
import { openDb, runMigrations, type Appointment } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('../workflow', () => ({ enqueueBookingEmail: vi.fn(), enqueueCalendarSync: vi.fn() }));
import { enqueueBookingEmail, enqueueCalendarSync } from '../workflow';

const now = new Date('2026-05-01T13:00:00Z');

const existing: Appointment = {
	id: 'appt-1',
	event_type_id: 'chat',
	start_time: '2026-05-01T15:00:00Z',
	end_time: '2026-05-01T15:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_answers: null,
	attendee_timezone: null,
	location: null,
	status: 'confirmed',
	origin_id: 'appt-1',
	rescheduled_from_id: null,
	rescheduled_to_id: null,
	cancel_token: 'tok-good',
	external_event_id: null,
	external_calendar_id: null,
	email_notification_status: null,
	calendar_push_notification_status: null,
	calendar_revision: 0,
	calendar_synced_revision: null,
	has_possible_conflict: 0,
	calendar_push_failing_since: null,
	ics_sequence: 0,
	created_at: '',
	updated_at: ''
};

const eventType = { id: 'chat', minimum_notice: 60 };

describe('classifyReschedule', () => {
	test('fresh when no rescheduleId', () => {
		expect(
			classifyReschedule({
				rescheduleId: null,
				token: null,
				existing: undefined,
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
				eventType: { id: 'other', minimum_notice: 60 },
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
				eventType,
				now: after
			})
		).toEqual({ kind: 'error', code: 'minimum_notice' });
	});

	test('missing minimum_notice on event type defaults to 0', () => {
		const justBeforeStart = new Date('2026-05-01T14:59:00Z');
		expect(
			classifyReschedule({
				rescheduleId: 'appt-1',
				token: 'tok-good',
				existing,
				eventType: { id: 'chat' },
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
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_answers: null,
	attendee_timezone: null,
	location: null,
	external_event_id: null,
	external_calendar_id: null,
	email_notification_status: null,
	calendar_push_notification_status: null
};

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

async function fetchRow(db: Awaited<ReturnType<typeof makeDb>>, id: string) {
	return db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

describe('rescheduleAppointment', () => {
	beforeEach(() => {
		vi.mocked(enqueueBookingEmail).mockReset();
		vi.mocked(enqueueBookingEmail).mockImplementation((db, id) =>
			db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
		);
		vi.mocked(enqueueCalendarSync).mockReset();
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
					appointment: row,
					initiator: 'attendee',
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
				expect(next.rescheduled_from_id).toBe('r1');
				expect(next.cancel_token).not.toBe('t1');
				expect(next.calendar_push_notification_status).toBe('queued');

				const old = await fetchRow(db, 'r1');
				expect(old.status).toBe('rescheduled');
				expect(old.rescheduled_to_id).toBe(next.id);

				expect(enqueueCalendarSync).toHaveBeenCalledTimes(1);
				expect(enqueueBookingEmail).toHaveBeenCalledWith(
					expect.anything(),
					next.id,
					'rescheduled-by-attendee'
				);
			}
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
					appointment: row,
					initiator: 'organizer',
					newStart: '2099-03-02T10:00:00Z',
					newEnd: '2099-03-02T10:30:00Z'
				}
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.origin_id).toBe('r5');
				expect(result.appointment.external_event_id).toBe('r5');
				expect(result.appointment.external_calendar_id).toBe('work');
				expect(enqueueBookingEmail).toHaveBeenCalledWith(
					expect.anything(),
					result.appointment.id,
					'rescheduled-by-organizer'
				);
			}
		} finally {
			await db.destroy();
		}
	});

	const reapprovalCfg: WhenConfiguration = {
		...validConfig,
		event_types: [
			{
				...validConfig.event_types[0],
				id: 'confirm-me',
				slug: 'confirm-me',
				booking_flow: 'requires_confirmation'
			}
		]
	};

	test('attendee moving a confirmed requires-confirmation booking reverts to pending, keeps the event', async () => {
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
					appointment: row,
					initiator: 'attendee',
					newStart: '2099-04-02T10:00:00Z',
					newEnd: '2099-04-02T10:30:00Z'
				}
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.status).toBe('pending');
				expect(result.appointment.external_event_id).toBe('rc1');
				expect(result.appointment.calendar_push_notification_status).toBeNull();
			}
		} finally {
			await db.destroy();
		}
	});

	test('organizer moving the same requires-confirmation booking stays confirmed', async () => {
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
					appointment: row,
					initiator: 'organizer',
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

	test('gated: cancelled booking returns { ok: false, reason: gated }', async () => {
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
					appointment: row,
					initiator: 'attendee',
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
			// Existing booking we want to move
			await db
				.insertInto('appointments')
				.values({ ...opBaseRow, id: 'r3a', status: 'confirmed', cancel_token: 't3a' })
				.execute();
			// Conflicting active booking in the target slot (same event_type, same start)
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
					appointment: row,
					initiator: 'attendee',
					newStart: '2099-02-01T10:00:00Z',
					newEnd: '2099-02-01T10:30:00Z'
				}
			);
			expect(result).toEqual({ ok: false, reason: 'slot_taken' });

			// Original row unchanged
			const persisted = await fetchRow(db, 'r3a');
			expect(persisted.start_time).toBe('2099-01-01T15:00:00Z');
		} finally {
			await db.destroy();
		}
	});

	test('conflict: row already cancelled by concurrent caller surfaces as conflict', async () => {
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

			const result = await rescheduleAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{
					appointment: row,
					initiator: 'attendee',
					newStart: '2099-01-02T10:00:00Z',
					newEnd: '2099-01-02T10:30:00Z'
				}
			);
			expect(result).toEqual({ ok: false, reason: 'conflict' });
		} finally {
			await db.destroy();
		}
	});
});
