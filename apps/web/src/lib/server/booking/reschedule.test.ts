import { describe, expect, test } from 'vitest';
import { classifyReschedule, rescheduleAppointment } from './reschedule';
import { systemClock } from '$lib/server/clock';
import { openDb, runMigrations, type Appointment } from '@when/db';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

const now = new Date('2026-05-01T13:00:00Z');

const existing: Appointment = {
	id: 'appt-1',
	event_type_id: 'chat',
	start_time: '2026-05-01T15:00:00Z',
	end_time: '2026-05-01T15:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_notes: null,
	location: null,
	status: 'confirmed',
	cancel_token: 'tok-good',
	external_event_id: null,
	external_calendar_id: null,
	email_notification_status: null,
	calendar_push_notification_status: null,
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
	attendee_notes: null,
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
	test('happy path: confirmed booking moves time, ics_sequence bumps, status preserved', async () => {
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
					newEnd: '2099-01-02T10:30:00Z',
					baseUrl: 'https://when.example.com'
				}
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.start_time).toBe('2099-01-02T10:00:00Z');
				expect(result.appointment.end_time).toBe('2099-01-02T10:30:00Z');
				expect(result.appointment.status).toBe('confirmed');
				expect(result.appointment.ics_sequence).toBe(1);
			}
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
					newEnd: '2099-01-02T10:30:00Z',
					baseUrl: 'https://when.example.com'
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
					newEnd: '2099-02-01T10:30:00Z',
					baseUrl: 'https://when.example.com'
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
					newEnd: '2099-01-02T10:30:00Z',
					baseUrl: 'https://when.example.com'
				}
			);
			expect(result).toEqual({ ok: false, reason: 'conflict' });
		} finally {
			await db.destroy();
		}
	});
});
