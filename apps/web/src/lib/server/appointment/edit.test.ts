import { beforeEach, describe, expect, test, vi } from 'vitest';
import { editAppointment } from './edit';
import { systemClock } from '$lib/server/clock';
import { openDb, runMigrations, parseActionLog } from '@when/db';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('../workflow', () => ({ enqueueAppointmentEmail: vi.fn(), enqueueCalendarSync: vi.fn() }));
import { enqueueAppointmentEmail, enqueueCalendarSync } from '../workflow';

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
		vi.mocked(enqueueAppointmentEmail).mockReset();
		vi.mocked(enqueueAppointmentEmail).mockImplementation((db, id) =>
			db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
		);
		vi.mocked(enqueueCalendarSync).mockReset();
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
				{ appointment: row, note: 'Read the handbook' }
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
				{ appointment: row, note: 'Read the updated handbook' }
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
				{ appointment: row, note: null }
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

			expect(enqueueCalendarSync).toHaveBeenCalledTimes(3);
			expect(enqueueAppointmentEmail).toHaveBeenCalledTimes(3);
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
				{ appointment: row, video_chat: 'https://zoom.us/j/12345' }
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
				{ appointment: row, video_chat: 'https://zoom.us/j/67890' }
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
				{ appointment: row, video_chat: null }
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

			expect(enqueueCalendarSync).toHaveBeenCalledTimes(3);
			expect(enqueueAppointmentEmail).toHaveBeenCalledTimes(3);
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
				{ appointment: row, note: 'Unchanged' }
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
				{ appointment: row, note: 'Some new note' }
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
				{ appointment: row, note: 'Some new note' }
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
				{ appointment: row, location: 'Meeting Room A' }
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
				{ appointment: row, location: 'Meeting Room B' }
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
				{ appointment: row, location: null }
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

			expect(enqueueCalendarSync).toHaveBeenCalledTimes(3);
			expect(enqueueAppointmentEmail).toHaveBeenCalledTimes(3);
		} finally {
			await db.destroy();
		}
	});
});
