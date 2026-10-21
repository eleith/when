import { beforeEach, describe, expect, test, vi } from 'vitest';
import { editAppointment } from './edit';
import { systemClock } from '$lib/server/clock';
import { openDb, runMigrations, parseActionLog } from '@when/db';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('../workflow', () => ({ enqueueAppointmentReconciliation: vi.fn() }));
import { enqueueAppointmentReconciliation } from '../workflow';

const baseRow = {
	event_type_id: '30-min-chat',
	start_time: '2099-01-01T15:00:00Z',
	end_time: '2099-01-01T15:30:00Z',
	guest_name: 'Booker',
	guest_email: 'booker@example.com',
	guest_answers: null,
	location: null,
	note: null,
	video_chat: null,
	external_event_id: null,
	external_calendar_id: null
};

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

async function fetchRow(db: Awaited<ReturnType<typeof makeDb>>, id: string) {
	return db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

describe('editAppointment', () => {
	beforeEach(() => {
		vi.mocked(enqueueAppointmentReconciliation).mockReset();
		vi.mocked(enqueueAppointmentReconciliation).mockImplementation(async (db, id) =>
			db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
		);
	});

	test.each(['note', 'location'] as const)(
		'editing %s preserves newer omitted fields',
		async (field) => {
			const db = await makeDb();
			try {
				await db
					.insertInto('appointments')
					.values({
						...baseRow,
						id: 'fresh',
						status: 'confirmed',
						cancel_token: 'fresh',
						location: 'Old location',
						video_chat: 'https://old.example/room'
					})
					.execute();
				const page = await fetchRow(db, 'fresh');
				await db
					.updateTable('appointments')
					.set({
						note: 'Current note',
						location: 'Current location',
						video_chat: 'https://current.example/room',
						video_chat_request: 'suppress',
						calendar_revision: 1,
						ics_sequence: 1
					})
					.where('id', '=', page.id)
					.execute();

				const result = await editAppointment(
					{ db, cfg: validConfig, clock: systemClock },
					{ appointmentId: page.id, [field]: 'New value' }
				);

				expect(result.ok).toBe(true);
				const saved = await fetchRow(db, 'fresh');
				expect(saved).toMatchObject({
					note: 'Current note',
					location: 'Current location',
					video_chat: 'https://current.example/room',
					video_chat_request: 'suppress',
					calendar_revision: 2,
					ics_sequence: 2,
					[field]: 'New value'
				});
				const history = parseActionLog(saved.action_log);
				expect(history).toHaveLength(1);
				expect(history[0].payload?.metadata?.changes).toEqual([`${field}_updated`]);
				expect(enqueueAppointmentReconciliation).toHaveBeenCalledWith(
					db,
					page.id,
					'edited-by-host',
					null
				);
			} finally {
				await db.destroy();
			}
		}
	);

	test('video replacement compares against the current link, not the page snapshot', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					...baseRow,
					id: 'replacement',
					status: 'confirmed',
					cancel_token: 'replacement',
					video_chat: 'https://old.example/room'
				})
				.execute();
			const page = await fetchRow(db, 'replacement');
			await db
				.updateTable('appointments')
				.set({
					video_chat: 'https://current.example/room',
					calendar_revision: 1,
					ics_sequence: 1
				})
				.where('id', '=', page.id)
				.execute();

			const result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: page.id, video_chat: page.video_chat }
			);

			expect(result.ok).toBe(true);
			const saved = await fetchRow(db, 'replacement');
			expect(saved).toMatchObject({
				video_chat: page.video_chat,
				calendar_revision: 2,
				ics_sequence: 2
			});
			expect(enqueueAppointmentReconciliation).toHaveBeenCalledWith(
				db,
				page.id,
				'edited-by-host',
				'https://current.example/room'
			);
		} finally {
			await db.destroy();
		}
	});

	test.each([
		['cancelled', { status: 'cancelled' as const }],
		['concluded', { end_time: '2000-01-01T15:30:00Z' }]
	])('gates the current %s appointment before writing', async (_name, changes) => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					...baseRow,
					id: 'gated',
					status: 'confirmed',
					cancel_token: 'gated'
				})
				.execute();
			const page = await fetchRow(db, 'gated');
			await db.updateTable('appointments').set(changes).where('id', '=', page.id).execute();
			const before = await fetchRow(db, page.id);

			const result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: page.id, note: 'Too late' }
			);

			expect(result).toEqual({ ok: false, reason: 'gated' });
			const after = await fetchRow(db, page.id);
			expect(after).toEqual(before);
			expect(enqueueAppointmentReconciliation).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});

	test('concurrent partial edits keep both changes', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					...baseRow,
					id: 'concurrent',
					status: 'confirmed',
					cancel_token: 'concurrent'
				})
				.execute();
			const ctx = { db, cfg: validConfig, clock: systemClock };

			const results = await Promise.all([
				editAppointment(ctx, { appointmentId: 'concurrent', note: 'New note' }),
				editAppointment(ctx, { appointmentId: 'concurrent', location: 'New location' })
			]);

			expect(results.every((result) => result.ok)).toBe(true);
			const saved = await fetchRow(db, 'concurrent');
			expect(saved).toMatchObject({
				note: 'New note',
				location: 'New location',
				ics_sequence: 2,
				calendar_revision: 2
			});
			const history = parseActionLog(saved.action_log);
			expect(history).toHaveLength(2);
			expect(enqueueAppointmentReconciliation).toHaveBeenCalledTimes(2);
		} finally {
			await db.destroy();
		}
	});

	test('a missing appointment cannot be edited or queued', async () => {
		const db = await makeDb();
		try {
			const result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: 'missing', note: 'No appointment' }
			);
			expect(result).toEqual({ ok: false, reason: 'conflict' });
			expect(enqueueAppointmentReconciliation).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});

	test('does not fabricate an edit when the submitted note already matches the current row', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'no-change', status: 'confirmed', cancel_token: 'no-change' })
				.execute();
			await db
				.updateTable('appointments')
				.set({ note: 'Current note', calendar_revision: 1, ics_sequence: 1 })
				.where('id', '=', 'no-change')
				.execute();
			const before = await fetchRow(db, 'no-change');

			const result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: 'no-change', note: 'Current note' }
			);

			expect(result).toEqual({ ok: false, reason: 'no_changes' });
			const after = await fetchRow(db, 'no-change');
			expect(after).toEqual(before);
			expect(enqueueAppointmentReconciliation).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});

	test('happy path: add note, edit note, remove note', async () => {
		const db = await makeDb();
		try {
			// Seed a confirmed appointment with no note
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a1', status: 'confirmed', cancel_token: 't1' })
				.execute();

			// 1. Add Note
			let row = await fetchRow(db, 'a1');
			let result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: row.id, note: 'Read the handbook' }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.note).toBe('Read the handbook');
				expect(result.appointment.calendar_revision).toBe(1);
				expect(result.appointment.ics_sequence).toBe(1);
				const log = parseActionLog(result.appointment.action_log);
				expect(log.length).toBe(1);
				expect(log[0].action).toBe('edit');
				expect(log[0].payload?.metadata?.changes).toEqual(['note_added']);
			}

			// 2. Edit Note
			row = await fetchRow(db, 'a1');
			result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: row.id, note: 'Read the updated handbook' }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.note).toBe('Read the updated handbook');
				expect(result.appointment.calendar_revision).toBe(2);
				expect(result.appointment.ics_sequence).toBe(2);
				const log = parseActionLog(result.appointment.action_log);
				expect(log.length).toBe(2);
				expect(log[1].payload?.metadata?.changes).toEqual(['note_updated']);
			}

			// 3. Remove Note (passing null or empty string)
			row = await fetchRow(db, 'a1');
			result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: row.id, note: null }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.note).toBeNull();
				expect(result.appointment.calendar_revision).toBe(3);
				expect(result.appointment.ics_sequence).toBe(3);
				const log = parseActionLog(result.appointment.action_log);
				expect(log.length).toBe(3);
				expect(log[2].payload?.metadata?.changes).toEqual(['note_removed']);
			}

			expect(enqueueAppointmentReconciliation).toHaveBeenCalledTimes(3);
		} finally {
			await db.destroy();
		}
	});

	test('happy path: add video_chat, edit video_chat, remove video_chat', async () => {
		const db = await makeDb();
		try {
			// Seed a confirmed appointment with no video_chat link
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a1_c', status: 'confirmed', cancel_token: 't1_c' })
				.execute();

			// 1. Add Video Chat
			let row = await fetchRow(db, 'a1_c');
			let result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: row.id, video_chat: 'https://zoom.us/j/12345' }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.video_chat).toBe('https://zoom.us/j/12345');
				expect(result.appointment.calendar_revision).toBe(1);
				expect(result.appointment.ics_sequence).toBe(1);
				const log = parseActionLog(result.appointment.action_log);
				expect(log.length).toBe(1);
				expect(log[0].action).toBe('edit');
				expect(log[0].payload?.metadata?.changes).toEqual(['video_chat_added']);
			}

			// 2. Edit Video Chat
			row = await fetchRow(db, 'a1_c');
			result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: row.id, video_chat: 'https://zoom.us/j/67890' }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.video_chat).toBe('https://zoom.us/j/67890');
				expect(result.appointment.calendar_revision).toBe(2);
				expect(result.appointment.ics_sequence).toBe(2);
				const log = parseActionLog(result.appointment.action_log);
				expect(log.length).toBe(2);
				expect(log[1].payload?.metadata?.changes).toEqual(['video_chat_updated']);
			}

			// 3. Remove Video Chat (passing null or empty string)
			row = await fetchRow(db, 'a1_c');
			result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: row.id, video_chat: null }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.video_chat).toBeNull();
				expect(result.appointment.calendar_revision).toBe(3);
				expect(result.appointment.ics_sequence).toBe(3);
				const log = parseActionLog(result.appointment.action_log);
				expect(log.length).toBe(3);
				expect(log[2].payload?.metadata?.changes).toEqual(['video_chat_removed']);
			}

			expect(enqueueAppointmentReconciliation).toHaveBeenCalledTimes(3);
			expect(vi.mocked(enqueueAppointmentReconciliation).mock.calls[0][3]).toBeNull();
			expect(vi.mocked(enqueueAppointmentReconciliation).mock.calls[1][3]).toBe(
				'https://zoom.us/j/12345'
			);
			expect(vi.mocked(enqueueAppointmentReconciliation).mock.calls[2][3]).toBe(
				'https://zoom.us/j/67890'
			);
		} finally {
			await db.destroy();
		}
	});

	test('fails with no_changes if note is unchanged', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					...baseRow,
					id: 'a2',
					status: 'confirmed',
					cancel_token: 't2',
					note: 'Unchanged'
				})
				.execute();
			const row = await fetchRow(db, 'a2');

			const result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: row.id, note: 'Unchanged' }
			);

			expect(result).toEqual({ ok: false, reason: 'no_changes' });
		} finally {
			await db.destroy();
		}
	});

	test('gated: cannot edit a cancelled/terminal appointment', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'a3', status: 'cancelled', cancel_token: 't3' })
				.execute();
			const row = await fetchRow(db, 'a3');

			const result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: row.id, note: 'Some new note' }
			);

			expect(result).toEqual({ ok: false, reason: 'gated' });
		} finally {
			await db.destroy();
		}
	});

	test('gated: cannot edit a concluded appointment', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					...baseRow,
					id: 'a-concluded',
					status: 'confirmed',
					cancel_token: 't-concluded',
					end_time: '2000-01-01T15:30:00Z'
				})
				.execute();
			const row = await fetchRow(db, 'a-concluded');

			const result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: row.id, note: 'Some new note' }
			);

			expect(result).toEqual({ ok: false, reason: 'gated' });
		} finally {
			await db.destroy();
		}
	});

	test('happy path: add location, edit location, remove location', async () => {
		const db = await makeDb();
		try {
			// Seed a confirmed appointment with no location
			await db
				.insertInto('appointments')
				.values({ ...baseRow, id: 'loc1', status: 'confirmed', cancel_token: 't-loc1' })
				.execute();

			// 1. Add Location
			let row = await fetchRow(db, 'loc1');
			let result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: row.id, location: 'Meeting Room A' }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.location).toBe('Meeting Room A');
				expect(result.appointment.calendar_revision).toBe(1);
				expect(result.appointment.ics_sequence).toBe(1);
				const log = parseActionLog(result.appointment.action_log);
				expect(log.length).toBe(1);
				expect(log[0].action).toBe('edit');
				expect(log[0].payload?.metadata?.changes).toEqual(['location_added']);
			}

			// 2. Edit Location
			row = await fetchRow(db, 'loc1');
			result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: row.id, location: 'Meeting Room B' }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.location).toBe('Meeting Room B');
				expect(result.appointment.calendar_revision).toBe(2);
				expect(result.appointment.ics_sequence).toBe(2);
				const log = parseActionLog(result.appointment.action_log);
				expect(log.length).toBe(2);
				expect(log[1].payload?.metadata?.changes).toEqual(['location_updated']);
			}

			// 3. Remove Location (passing null or empty string)
			row = await fetchRow(db, 'loc1');
			result = await editAppointment(
				{ db, cfg: validConfig, clock: systemClock },
				{ appointmentId: row.id, location: null }
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.appointment.location).toBeNull();
				expect(result.appointment.calendar_revision).toBe(3);
				expect(result.appointment.ics_sequence).toBe(3);
				const log = parseActionLog(result.appointment.action_log);
				expect(log.length).toBe(3);
				expect(log[2].payload?.metadata?.changes).toEqual(['location_removed']);
			}

			expect(enqueueAppointmentReconciliation).toHaveBeenCalledTimes(3);
		} finally {
			await db.destroy();
		}
	});
});
