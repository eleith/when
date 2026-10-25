import { expect, test } from 'vitest';
import { openDb, runMigrations, withWriteTransaction } from '@when/db';
import {
	confirmAppointment,
	rescheduleAppointmentTransition,
	cancelAppointmentTransition,
	declineAppointmentTransition,
	rotateGuestTokenTransition
} from './transitions';

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

const baseRow = {
	event_type_id: 'chat',
	start_time: '2099-01-01T15:00:00Z',
	end_time: '2099-01-01T15:30:00Z',
	guest_name: 'Booker',
	guest_email: 'booker@example.com',
	guest_answers: null,
	location: null,
	external_event_id: null,
	external_calendar_id: null
};

const insert = (db: Awaited<ReturnType<typeof makeDb>>, over: Record<string, unknown>) =>
	db
		.insertInto('appointments')
		.values({ ...baseRow, ...over } as never)
		.execute();

const fetchRow = (db: Awaited<ReturnType<typeof makeDb>>, id: string) =>
	db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

test('confirmAppointment confirms a pending appointment, queues the sync, bumps the revision', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'pending', cancel_token: 't1' });
		expect(await confirmAppointment(db, '1', '2026-01-01T12:00:00Z')).toEqual({ ok: true });
		const row = await fetchRow(db, '1');
		expect(row.status).toBe('confirmed');
		expect(row.calendar_revision).toBe(1);
		expect(JSON.parse(row.action_log!)).toEqual([
			{ action: 'confirm', actor: 'host', at: '2026-01-01T12:00:00Z' }
		]);
	} finally {
		await db.destroy();
	}
});

test('confirmAppointment reports conflict when not pending, not_found when missing', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'confirmed', cancel_token: 't1' });
		expect(await confirmAppointment(db, '1', '2026-01-01T12:00:00Z')).toEqual({
			ok: false,
			reason: 'conflict'
		});
		expect(await confirmAppointment(db, 'ghost', '2026-01-01T12:00:00Z')).toEqual({
			ok: false,
			reason: 'not_found'
		});
	} finally {
		await db.destroy();
	}
});

test('rescheduleAppointmentTransition ends the old row and creates a linked new one at the new time', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'confirmed', cancel_token: 't1', origin_id: '1' });
		const old = await fetchRow(db, '1');

		const result = await withWriteTransaction(db, async (connection) => {
			const current = await fetchRow(connection, old.id);
			const moved = await rescheduleAppointmentTransition(
				connection,
				current,
				'guest',
				'2026-01-01T13:00:00Z',
				{
					newStart: '2099-02-01T10:00:00Z',
					newEnd: '2099-02-01T10:30:00Z',
					newStatus: 'confirmed',
					eventTypeSnapshot: '{}'
				}
			);
			return moved;
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const next = result.appointment;
		expect(next.id).not.toBe('1');
		expect(next.start_time).toBe('2099-02-01T10:00:00Z');
		expect(next.status).toBe('confirmed');
		expect(next.ics_sequence).toBe(1);
		expect(next.origin_id).toBe('1');

		const expectedLog = [
			{
				action: 'reschedule',
				actor: 'guest',
				at: '2026-01-01T13:00:00Z',
				payload: {
					field: 'status',
					from: 'confirmed',
					to: 'rescheduled',
					metadata: { next_id: next.id, previous_id: '1' }
				}
			}
		];

		expect(JSON.parse(next.action_log!)).toEqual(expectedLog);

		const ended = await fetchRow(db, '1');
		expect(ended.status).toBe('rescheduled');
		expect(JSON.parse(ended.action_log!)).toEqual(expectedLog);
	} finally {
		await db.destroy();
	}
});

test('rescheduleAppointmentTransition reports conflict when the old row is no longer active', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'confirmed', cancel_token: 't1', origin_id: '1' });
		const old = await fetchRow(db, '1');
		await db
			.updateTable('appointments')
			.set({ status: 'cancelled' })
			.where('id', '=', '1')
			.execute();

		const result = await withWriteTransaction(db, async (connection) => {
			const current = await fetchRow(connection, old.id);
			const moved = await rescheduleAppointmentTransition(
				connection,
				current,
				'guest',
				'2026-01-01T13:00:00Z',
				{
					newStart: '2099-02-01T10:00:00Z',
					newEnd: '2099-02-01T10:30:00Z',
					newStatus: 'confirmed',
					eventTypeSnapshot: '{}'
				}
			);
			return moved;
		});
		expect(result).toEqual({ ok: false, reason: 'conflict' });
	} finally {
		await db.destroy();
	}
});

test('rescheduleAppointmentTransition saves the reschedule reason note in the action log', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'confirmed', cancel_token: 't1', origin_id: '1' });
		const old = await fetchRow(db, '1');

		const result = await withWriteTransaction(db, async (connection) => {
			const current = await fetchRow(connection, old.id);
			const moved = await rescheduleAppointmentTransition(
				connection,
				current,
				'guest',
				'2026-01-01T13:00:00Z',
				{
					newStart: '2099-02-01T10:00:00Z',
					newEnd: '2099-02-01T10:30:00Z',
					newStatus: 'confirmed',
					eventTypeSnapshot: '{}',
					reason: 'scheduling conflict'
				}
			);
			return moved;
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const next = result.appointment;

		const expectedLog = [
			{
				action: 'reschedule',
				actor: 'guest',
				at: '2026-01-01T13:00:00Z',
				payload: {
					field: 'status',
					from: 'confirmed',
					to: 'rescheduled',
					note: 'scheduling conflict',
					metadata: { next_id: next.id, previous_id: '1' }
				}
			}
		];

		expect(JSON.parse(next.action_log!)).toEqual(expectedLog);

		const ended = await fetchRow(db, '1');
		expect(JSON.parse(ended.action_log!)).toEqual(expectedLog);
	} finally {
		await db.destroy();
	}
});

test('cancelAppointmentTransition queues the sync only when there is a published event', async () => {
	const db = await makeDb();
	try {
		await insert(db, {
			id: 'published',
			status: 'confirmed',
			cancel_token: 't1',
			external_event_id: 'ext-1',
			external_calendar_id: 'work'
		});
		await insert(db, {
			id: 'unpublished',
			status: 'confirmed',
			cancel_token: 't2',
			start_time: '2099-01-02T15:00:00Z',
			end_time: '2099-01-02T15:30:00Z'
		});

		await cancelAppointmentTransition(
			db,
			'published',
			'guest',
			'2026-01-01T14:00:00Z',
			'Reason note'
		);
		await cancelAppointmentTransition(db, 'unpublished', 'host', '2026-01-01T14:05:00Z');

		const pub = await fetchRow(db, 'published');
		expect(pub.status).toBe('cancelled');
		expect(pub.calendar_revision).toBe(1);
		expect(JSON.parse(pub.action_log!)).toEqual([
			{
				action: 'cancel',
				actor: 'guest',
				at: '2026-01-01T14:00:00Z',
				payload: { note: 'Reason note' }
			}
		]);

		const unpub = await fetchRow(db, 'unpublished');
		expect(unpub.status).toBe('cancelled');
		expect(JSON.parse(unpub.action_log!)).toEqual([
			{
				action: 'cancel',
				actor: 'host',
				at: '2026-01-01T14:05:00Z'
			}
		]);
	} finally {
		await db.destroy();
	}
});

test('declineAppointmentTransition declines a pending request; no event to remove when none was published', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'pending', cancel_token: 't1' });
		expect(await declineAppointmentTransition(db, '1', '2026-01-01T15:00:00Z')).toEqual({
			ok: true
		});
		const row = await fetchRow(db, '1');
		expect(row.status).toBe('declined');
		expect(JSON.parse(row.action_log!)).toEqual([
			{ action: 'decline', actor: 'host', at: '2026-01-01T15:00:00Z' }
		]);
		expect(await declineAppointmentTransition(db, '1', '2026-01-01T15:00:00Z')).toEqual({
			ok: false,
			reason: 'conflict'
		});
	} finally {
		await db.destroy();
	}
});

test('declineAppointmentTransition queues a delete when a re-approval revert carries an inherited event', async () => {
	const db = await makeDb();
	try {
		await insert(db, {
			id: '1',
			status: 'pending',
			cancel_token: 't1',
			external_event_id: 'evt-1',
			external_calendar_id: 'work'
		});
		expect(await declineAppointmentTransition(db, '1', '2026-01-01T15:00:00Z')).toEqual({
			ok: true
		});
		const row = await fetchRow(db, '1');
		expect(row.status).toBe('declined');
		expect(row.calendar_revision).toBe(1);
		expect(JSON.parse(row.action_log!)).toEqual([
			{ action: 'decline', actor: 'host', at: '2026-01-01T15:00:00Z' }
		]);
	} finally {
		await db.destroy();
	}
});

test.each([false, true])(
	'declineAppointmentTransition atomically appends a note and preserves the row (inherited event: %s)',
	async (inheritedEvent) => {
		const db = await makeDb();
		try {
			const previous = { action: 'confirm', actor: 'host', at: '2025-12-01T12:00:00Z' };
			await insert(db, {
				id: 'noted',
				status: 'pending',
				cancel_token: 'same-token',
				origin_id: 'same-origin',
				note: 'General preparation note',
				external_event_id: inheritedEvent ? 'inherited-event' : null,
				external_calendar_id: inheritedEvent ? 'work' : null,
				calendar_revision: 4,
				calendar_synced_revision: 4,
				ics_sequence: 2,
				action_log: JSON.stringify([previous])
			});
			const before = await fetchRow(db, 'noted');
			const note = 'Not available.\nPlease pick another day — désolé.';
			const at = '2026-01-01T15:00:00Z';

			const result = await declineAppointmentTransition(db, before.id, at, note);

			const after = await fetchRow(db, before.id);
			expect(result).toEqual({ ok: true });
			expect(after).toEqual({
				...before,
				status: 'declined',
				calendar_revision: 5,
				ics_sequence: 3,
				action_log: JSON.stringify([
					previous,
					{ action: 'decline', actor: 'host', at, payload: { note } }
				]),
				updated_at: after.updated_at
			});

			const repeated = await declineAppointmentTransition(
				db,
				before.id,
				'2026-01-01T16:00:00Z',
				'A second note must not replace the first'
			);
			const afterRepeat = await fetchRow(db, before.id);
			expect(repeated).toEqual({ ok: false, reason: 'conflict' });
			expect(afterRepeat).toEqual(after);
		} finally {
			await db.destroy();
		}
	}
);

test.each(['confirmed', 'cancelled', 'declined', 'rescheduled', 'purged'])(
	'declineAppointmentTransition leaves a %s row entirely unchanged even when given a note',
	async (status) => {
		const db = await makeDb();
		try {
			await insert(db, {
				id: 'gated',
				status,
				cancel_token: 'original-token',
				note: 'Original note',
				calendar_revision: 3,
				ics_sequence: 2
			});
			const before = await fetchRow(db, 'gated');

			const result = await declineAppointmentTransition(
				db,
				before.id,
				'2026-01-01T15:00:00Z',
				'Do not save this'
			);

			const after = await fetchRow(db, before.id);
			expect(result).toEqual({ ok: false, reason: 'conflict' });
			expect(after).toEqual(before);
		} finally {
			await db.destroy();
		}
	}
);

test('declineAppointmentTransition with a note reports a missing row', async () => {
	const db = await makeDb();
	try {
		const result = await declineAppointmentTransition(
			db,
			'missing',
			'2026-01-01T15:00:00Z',
			'No appointment to annotate'
		);

		expect(result).toEqual({ ok: false, reason: 'not_found' });
	} finally {
		await db.destroy();
	}
});

test('accept and noted decline racing on a pending row commit only the winning decision', async () => {
	const db = await makeDb();
	try {
		await insert(db, {
			id: 'race',
			status: 'pending',
			cancel_token: 'same-token',
			note: 'General note'
		});
		const at = '2026-01-01T15:00:00Z';
		const note = 'Decline reason';

		const [accepted, declined] = await Promise.all([
			confirmAppointment(db, 'race', at),
			declineAppointmentTransition(db, 'race', at, note)
		]);

		const row = await fetchRow(db, 'race');
		expect([accepted.ok, declined.ok].filter(Boolean)).toHaveLength(1);
		expect(accepted.ok ? declined : accepted).toEqual({ ok: false, reason: 'conflict' });
		expect(row.status).toBe(accepted.ok ? 'confirmed' : 'declined');
		expect(row.calendar_revision).toBe(1);
		expect(row.ics_sequence).toBe(accepted.ok ? 0 : 1);
		expect(row.id).toBe('race');
		expect(row.cancel_token).toBe('same-token');
		expect(row.note).toBe('General note');
		expect(JSON.parse(row.action_log!)).toEqual([
			accepted.ok
				? { action: 'confirm', actor: 'host', at }
				: { action: 'decline', actor: 'host', at, payload: { note } }
		]);
	} finally {
		await db.destroy();
	}
});

test('rotateGuestTokenTransition replaces the token and records the move', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'confirmed', cancel_token: 't1' });

		expect(await rotateGuestTokenTransition(db, '1', '2026-01-01T12:00:00Z')).toEqual({ ok: true });

		const row = await fetchRow(db, '1');
		expect(row.cancel_token).not.toBe('t1');
		expect(JSON.parse(row.action_log!)).toEqual([
			{ action: 'rotate', actor: 'host', at: '2026-01-01T12:00:00Z' }
		]);
	} finally {
		await db.destroy();
	}
});

test('rotateGuestTokenTransition keeps both tokens out of the log', async () => {
	const db = await makeDb();
	try {
		await insert(db, { id: '1', status: 'confirmed', cancel_token: 't1' });
		await rotateGuestTokenTransition(db, '1', '2026-01-01T12:00:00Z');

		const row = await fetchRow(db, '1');
		expect(row.action_log).not.toContain('t1');
		expect(row.action_log).not.toContain(row.cancel_token);
	} finally {
		await db.destroy();
	}
});

test.for(['rescheduled', 'purged'])(
	'rotateGuestTokenTransition refuses a %s row and leaves its token alone',
	async (status) => {
		const db = await makeDb();
		try {
			await insert(db, { id: '1', status, cancel_token: 't1' });

			expect(await rotateGuestTokenTransition(db, '1', '2026-01-01T12:00:00Z')).toEqual({
				ok: false,
				reason: 'conflict'
			});
			expect((await fetchRow(db, '1')).cancel_token).toBe('t1');
		} finally {
			await db.destroy();
		}
	}
);

test('rotateGuestTokenTransition reports a missing appointment', async () => {
	const db = await makeDb();
	try {
		expect(await rotateGuestTokenTransition(db, 'nope', '2026-01-01T12:00:00Z')).toEqual({
			ok: false,
			reason: 'not_found'
		});
	} finally {
		await db.destroy();
	}
});
