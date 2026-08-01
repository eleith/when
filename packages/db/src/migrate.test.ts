import { expect, test } from 'vitest';
import { sql } from 'kysely';
import { openDb } from './index.js';
import { migrationStatus, runMigrations } from './migrate.js';

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
			'external_calendar_busy',
			'oauth_tokens',
			'service_status'
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

test('migrationStatus reports a fresh database as all pending, and applies none of it', async () => {
	const db = openDb(':memory:');
	try {
		const status = await migrationStatus(db);
		expect(status.applied).toEqual([]);
		expect(status.pending).toContain('0001_initial');

		const tables = await sql<{ name: string }>`
			SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'kysely_%'
		`.execute(db);
		expect(tables.rows).toEqual([]);
	} finally {
		await db.destroy();
	}
});

test('migrationStatus reports nothing pending once migrated', async () => {
	const db = openDb(':memory:');
	try {
		await runMigrations(db);
		const status = await migrationStatus(db);
		expect(status.pending).toEqual([]);
		expect(status.applied).toContain('0001_initial');
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
