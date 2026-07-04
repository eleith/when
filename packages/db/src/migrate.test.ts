import { expect, test } from 'vitest';
import { Migrator, sql } from 'kysely';
import { openDb } from './index.js';
import { runMigrations } from './migrate.js';
import { migrations } from './migrations/index.js';

test('runMigrations creates appointments and oauth_tokens', async () => {
	const db = openDb(':memory:');
	try {
		const applied = await runMigrations(db);
		expect(applied).toContain('0001_initial');

		const tables = await sql<{ name: string }>`
			SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'kysely_%'
		`.execute(db);
		const tableNames = tables.rows.map((r) => r.name).sort();
		expect(tableNames).toEqual([
			'appointments',
			'calendar_sync_status',
			'external_calendar_busy',
			'oauth_tokens'
		]);

		const indexes = await sql<{ name: string }>`
			SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='appointments'
		`.execute(db);
		expect(indexes.rows.map((r) => r.name)).toContain('active_slot');
	} finally {
		await db.destroy();
	}
});

test('partial unique index rejects concurrent active slot but allows cancelled', async () => {
	const db = openDb(':memory:');
	try {
		await runMigrations(db);
		const base = {
			event_type_id: 'chat',
			start_time: '2026-05-01T10:00:00Z',
			end_time: '2026-05-01T10:30:00Z',
			guest_name: 'A',
			guest_email: 'a@example.com',
			location: null,
			external_event_id: null,
			external_calendar_id: null
		};

		await db
			.insertInto('appointments')
			.values({ ...base, id: '1', status: 'confirmed', cancel_token: 't1' })
			.execute();

		await expect(
			db
				.insertInto('appointments')
				.values({ ...base, id: '2', status: 'pending', cancel_token: 't2' })
				.execute()
		).rejects.toThrow();

		await db
			.insertInto('appointments')
			.values({ ...base, id: '3', status: 'cancelled', cancel_token: 't3' })
			.execute();
	} finally {
		await db.destroy();
	}
});

test('response_token column is dropped after migrations', async () => {
	const db = openDb(':memory:');
	try {
		await runMigrations(db);
		const cols = await sql<{ name: string }>`PRAGMA table_info(appointments)`.execute(db);
		const colNames = cols.rows.map((r) => r.name);
		expect(colNames).not.toContain('response_token');
	} finally {
		await db.destroy();
	}
});

test('the notification status columns are dropped (status lives in the action log)', async () => {
	const db = openDb(':memory:');
	try {
		await runMigrations(db);
		const cols = await sql<{ name: string }>`PRAGMA table_info(appointments)`.execute(db);
		const colNames = cols.rows.map((r) => r.name);
		expect(colNames).not.toContain('notification_status');
		expect(colNames).not.toContain('email_notification_status');
		expect(colNames).not.toContain('calendar_push_notification_status');
	} finally {
		await db.destroy();
	}
});

test('calendar mirror tables and busy range index exist', async () => {
	const db = openDb(':memory:');
	try {
		await runMigrations(db);

		const busyCols = await sql<{ name: string }>`PRAGMA table_info(external_calendar_busy)`.execute(
			db
		);
		expect(busyCols.rows.map((r) => r.name).sort()).toEqual([
			'calendar_id',
			'end_time',
			'id',
			'start_time'
		]);

		const indexes = await sql<{ name: string }>`
			SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='external_calendar_busy'
		`.execute(db);
		expect(indexes.rows.map((r) => r.name)).toContain('external_calendar_busy_range');
	} finally {
		await db.destroy();
	}
});

test('0007 adds the appointment calendar columns', async () => {
	const db = openDb(':memory:');
	try {
		await runMigrations(db);
		const cols = await sql<{ name: string }>`PRAGMA table_info(appointments)`.execute(db);
		const colNames = cols.rows.map((r) => r.name);
		expect(colNames).toContain('calendar_revision');
		expect(colNames).toContain('calendar_synced_revision');
		expect(colNames).toContain('has_possible_conflict');
		expect(colNames).not.toContain('calendar_push_failing_since');
	} finally {
		await db.destroy();
	}
});

test('0007 backfills synced_revision only for already-published rows', async () => {
	const db = openDb(':memory:');
	try {
		const migrator = new Migrator({
			db,
			provider: { getMigrations: async () => migrations }
		});
		// Migrate up to just before the new columns, then seed two rows.
		const before = await migrator.migrateTo('0006_calendar_mirror_tables');
		expect(before.error).toBeUndefined();

		// Pre-0018 the columns are still attendee_*; seed via raw SQL to match the schema here.
		await sql`INSERT INTO appointments
			(id, event_type_id, start_time, end_time, attendee_name, attendee_email, location, status, cancel_token, external_event_id, external_calendar_id)
			VALUES ('pub', 'chat', '2026-05-01T10:00:00Z', '2026-05-01T10:30:00Z', 'A', 'a@example.com', NULL, 'confirmed', 't1', 'ext-1', 'work')`.execute(
			db
		);
		await sql`INSERT INTO appointments
			(id, event_type_id, start_time, end_time, attendee_name, attendee_email, location, status, cancel_token, external_event_id, external_calendar_id)
			VALUES ('unpub', 'chat', '2026-05-01T11:00:00Z', '2026-05-01T11:30:00Z', 'A', 'a@example.com', NULL, 'confirmed', 't2', NULL, NULL)`.execute(
			db
		);

		const after = await migrator.migrateTo('0007_appointment_calendar_columns');
		expect(after.error).toBeUndefined();

		const rows = await db
			.selectFrom('appointments')
			.select(['id', 'calendar_revision', 'calendar_synced_revision'])
			.execute();
		const pub = rows.find((r) => r.id === 'pub')!;
		const unpub = rows.find((r) => r.id === 'unpub')!;
		// Published row is marked in sync (synced === revision); never-published stays NULL.
		expect(pub.calendar_synced_revision).toBe(pub.calendar_revision);
		expect(unpub.calendar_synced_revision).toBeNull();
	} finally {
		await db.destroy();
	}
});

test('0012 drops attendee_notes, adds guest_answers, and allows a null email', async () => {
	const db = openDb(':memory:');
	try {
		await runMigrations(db);
		const cols = await sql<{
			name: string;
			notnull: number;
		}>`PRAGMA table_info(appointments)`.execute(db);
		const byName = new Map(cols.rows.map((r) => [r.name, r]));
		expect(byName.has('attendee_notes')).toBe(false);
		expect(byName.has('guest_answers')).toBe(true);
		expect(byName.get('guest_email')?.notnull).toBe(0);

		await db
			.insertInto('appointments')
			.values({
				id: 'no-email',
				event_type_id: 'chat',
				start_time: '2026-05-01T10:00:00Z',
				end_time: '2026-05-01T10:30:00Z',
				guest_name: 'A',
				guest_email: null,
				location: null,
				status: 'confirmed',
				cancel_token: 'tok'
			})
			.execute();
		const row = await db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', 'no-email')
			.executeTakeFirstOrThrow();
		expect(row.guest_email).toBeNull();
		expect(row.guest_answers).toBeNull();
	} finally {
		await db.destroy();
	}
});

test('0012 preserves the appointment indexes after the table rebuild', async () => {
	const db = openDb(':memory:');
	try {
		await runMigrations(db);
		const indexes = await sql<{ name: string }>`
			SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='appointments'
		`.execute(db);
		expect(indexes.rows.map((r) => r.name)).toEqual(
			expect.arrayContaining([
				'active_slot',
				'appointments_start_time',
				'appointments_status',
				'appointments_origin_id'
			])
		);
	} finally {
		await db.destroy();
	}
});

test('0012 copies existing rows and initialises guest_answers to null', async () => {
	const db = openDb(':memory:');
	try {
		const migrator = new Migrator({
			db,
			provider: { getMigrations: async () => migrations }
		});
		const before = await migrator.migrateTo('0011_origin_id_index');
		expect(before.error).toBeUndefined();

		// Pre-0018 the columns are still attendee_*; seed/read via raw SQL to match the schema here.
		await sql`INSERT INTO appointments
			(id, event_type_id, start_time, end_time, attendee_name, attendee_email, location, status, cancel_token)
			VALUES ('keep', 'chat', '2026-05-01T10:00:00Z', '2026-05-01T10:30:00Z', 'A', 'a@example.com', 'Room 1', 'confirmed', 't-keep')`.execute(
			db
		);

		const after = await migrator.migrateTo('0012_form_customization');
		expect(after.error).toBeUndefined();

		const row = await sql<{
			attendee_name: string;
			location: string;
			attendee_answers: string | null;
		}>`
			SELECT attendee_name, location, attendee_answers FROM appointments WHERE id = 'keep'`.execute(db);
		expect(row.rows[0].attendee_name).toBe('A');
		expect(row.rows[0].location).toBe('Room 1');
		expect(row.rows[0].attendee_answers).toBeNull();
	} finally {
		await db.destroy();
	}
});

test('migrations are idempotent when re-run', async () => {
	const db = openDb(':memory:');
	try {
		const first = await runMigrations(db);
		const second = await runMigrations(db);
		expect(first).toContain('0001_initial');
		expect(second).toEqual([]);
	} finally {
		await db.destroy();
	}
});

test('0018 renames attendee columns to guest and rewrites action_log actors', async () => {
	const db = openDb(':memory:');
	try {
		const migrator = new Migrator({
			db,
			provider: { getMigrations: async () => migrations }
		});
		const before = await migrator.migrateTo('0017_drop_notification_columns');
		expect(before.error).toBeUndefined();

		// Pre-0018: seed an attendee_* row whose action_log, answers, and snapshot carry old names.
		const log = JSON.stringify([
			{ action: 'create', actor: 'attendee', at: '2026-05-01T09:00:00Z' },
			{ action: 'confirm', actor: 'organizer', at: '2026-05-01T09:05:00Z' }
		]);
		const answers = JSON.stringify([
			{ id: 'name', label: 'Name', type: 'attendee_name', value: 'A' }
		]);
		const snapshot = JSON.stringify({
			form_fields: [{ id: 'name', type: 'attendee_name', label: 'Name', required: true }]
		});
		await sql`INSERT INTO appointments
			(id, event_type_id, start_time, end_time, attendee_name, attendee_email, attendee_answers, status, cancel_token, action_log, event_type_snapshot)
			VALUES ('a', 'chat', '2026-05-01T10:00:00Z', '2026-05-01T10:30:00Z', 'A', 'a@example.com', ${answers}, 'confirmed', 'tok', ${log}, ${snapshot})`.execute(
			db
		);

		const after = await migrator.migrateTo('0018_rename_attendee_to_guest');
		expect(after.error).toBeUndefined();

		const colNames = (
			await sql<{ name: string }>`PRAGMA table_info(appointments)`.execute(db)
		).rows.map((r) => r.name);
		expect(colNames).toEqual(
			expect.arrayContaining(['guest_name', 'guest_email', 'guest_answers', 'guest_timezone'])
		);
		expect(colNames).not.toContain('attendee_name');
		expect(colNames).not.toContain('attendee_email');

		const row = await db
			.selectFrom('appointments')
			.select(['guest_name', 'guest_answers', 'action_log', 'event_type_snapshot'])
			.where('id', '=', 'a')
			.executeTakeFirstOrThrow();
		expect(row.guest_name).toBe('A');
		const actors = (JSON.parse(row.action_log!) as { actor: string }[]).map((e) => e.actor);
		expect(actors).toEqual(['guest', 'host']);
		expect(JSON.parse(row.guest_answers!)[0].type).toBe('guest_name');
		expect(JSON.parse(row.event_type_snapshot!).form_fields[0].type).toBe('guest_name');
	} finally {
		await db.destroy();
	}
});

test('0019 adds the note column to appointments', async () => {
	const db = openDb(':memory:');
	try {
		await runMigrations(db);
		const cols = await sql<{ name: string }>`PRAGMA table_info(appointments)`.execute(db);
		const colNames = cols.rows.map((r) => r.name);
		expect(colNames).toContain('note');
	} finally {
		await db.destroy();
	}
});

test('0020 and 0022 migration: conference column is renamed to video_chat', async () => {
	const db = openDb(':memory:');
	try {
		await runMigrations(db);
		const cols = await sql<{ name: string }>`PRAGMA table_info(appointments)`.execute(db);
		const colNames = cols.rows.map((r) => r.name);
		expect(colNames).not.toContain('conference');
		expect(colNames).toContain('video_chat');
	} finally {
		await db.destroy();
	}
});
