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
			attendee_name: 'A',
			attendee_email: 'a@example.com',
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

test('calendar_sync_status.health defaults to unknown', async () => {
	const db = openDb(':memory:');
	try {
		await runMigrations(db);
		await db.insertInto('calendar_sync_status').values({ calendar_id: 'work' }).execute();
		const row = await db
			.selectFrom('calendar_sync_status')
			.selectAll()
			.where('calendar_id', '=', 'work')
			.executeTakeFirstOrThrow();
		expect(row.health).toBe('unknown');
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

		const base = {
			event_type_id: 'chat',
			start_time: '2026-05-01T10:00:00Z',
			end_time: '2026-05-01T10:30:00Z',
			attendee_name: 'A',
			attendee_email: 'a@example.com',
			location: null,
			status: 'confirmed' as const
		};
		await db
			.insertInto('appointments')
			.values({
				...base,
				id: 'pub',
				cancel_token: 't1',
				external_event_id: 'ext-1',
				external_calendar_id: 'work'
			})
			.execute();
		await db
			.insertInto('appointments')
			.values({
				...base,
				id: 'unpub',
				start_time: '2026-05-01T11:00:00Z',
				end_time: '2026-05-01T11:30:00Z',
				cancel_token: 't2',
				external_event_id: null,
				external_calendar_id: null
			})
			.execute();

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

test('0012 drops attendee_notes, adds attendee_answers, and allows a null email', async () => {
	const db = openDb(':memory:');
	try {
		await runMigrations(db);
		const cols = await sql<{
			name: string;
			notnull: number;
		}>`PRAGMA table_info(appointments)`.execute(db);
		const byName = new Map(cols.rows.map((r) => [r.name, r]));
		expect(byName.has('attendee_notes')).toBe(false);
		expect(byName.has('attendee_answers')).toBe(true);
		expect(byName.get('attendee_email')?.notnull).toBe(0);

		await db
			.insertInto('appointments')
			.values({
				id: 'no-email',
				event_type_id: 'chat',
				start_time: '2026-05-01T10:00:00Z',
				end_time: '2026-05-01T10:30:00Z',
				attendee_name: 'A',
				attendee_email: null,
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
		expect(row.attendee_email).toBeNull();
		expect(row.attendee_answers).toBeNull();
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

test('0012 copies existing rows and initialises attendee_answers to null', async () => {
	const db = openDb(':memory:');
	try {
		const migrator = new Migrator({
			db,
			provider: { getMigrations: async () => migrations }
		});
		const before = await migrator.migrateTo('0011_origin_id_index');
		expect(before.error).toBeUndefined();

		await db
			.insertInto('appointments')
			.values({
				id: 'keep',
				event_type_id: 'chat',
				start_time: '2026-05-01T10:00:00Z',
				end_time: '2026-05-01T10:30:00Z',
				attendee_name: 'A',
				attendee_email: 'a@example.com',
				location: 'Room 1',
				status: 'confirmed',
				cancel_token: 't-keep'
			})
			.execute();

		const after = await migrator.migrateTo('0012_form_customization');
		expect(after.error).toBeUndefined();

		const row = await db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', 'keep')
			.executeTakeFirstOrThrow();
		expect(row.attendee_name).toBe('A');
		expect(row.location).toBe('Room 1');
		expect(row.attendee_answers).toBeNull();
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
