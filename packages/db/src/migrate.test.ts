import { expect, test } from 'vitest';
import { sql } from 'kysely';
import { openDb } from './index.js';
import { runMigrations } from './migrate.js';

test('runMigrations creates appointments and oauth_tokens', async () => {
	const db = openDb(':memory:');
	try {
		const applied = await runMigrations(db);
		expect(applied).toContain('0001_initial');

		const tables = await sql<{ name: string }>`
			SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'kysely_%'
		`.execute(db);
		const tableNames = tables.rows.map((r) => r.name).sort();
		expect(tableNames).toEqual(['appointments', 'oauth_tokens']);

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
			attendee_notes: null,
			location: null,
			external_event_id: null,
			external_calendar_id: null,
			notification_status: null
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
