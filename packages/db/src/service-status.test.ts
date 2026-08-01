import { expect, test } from 'vitest';
import { Migrator, sql } from 'kysely';
import { openDb } from './index.js';
import { runMigrations } from './migrate.js';
import { migrations } from './migrations/index.js';
import { listServiceStatus, recordServiceOutcome } from './service-status.js';

async function freshDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

const calendar = { kind: 'calendar', name: 'work' } as const;

async function statusOf(db: Awaited<ReturnType<typeof freshDb>>, kind: string, name: string) {
	return db
		.selectFrom('service_status')
		.selectAll()
		.where('kind', '=', kind)
		.where('name', '=', name)
		.executeTakeFirstOrThrow();
}

test('a first success records the attempt and leaves nothing failing', async () => {
	const db = await freshDb();
	try {
		await recordServiceOutcome(db, calendar, { at: 't1', via: 'refresh' });
		const row = await statusOf(db, 'calendar', 'work');
		expect(row.last_attempt_at).toBe('t1');
		expect(row.last_ok_at).toBe('t1');
		expect(row.failing_since).toBeNull();
		expect(row.error).toBeNull();
		expect(row.via).toBe('refresh');
	} finally {
		await db.destroy();
	}
});

test('a failure keeps the last success and starts the streak', async () => {
	const db = await freshDb();
	try {
		await recordServiceOutcome(db, calendar, { at: 't1', via: 'refresh' });
		await recordServiceOutcome(db, calendar, { at: 't2', via: 'refresh', error: 'down' });
		const row = await statusOf(db, 'calendar', 'work');
		expect(row.last_attempt_at).toBe('t2');
		expect(row.last_ok_at).toBe('t1');
		expect(row.failing_since).toBe('t2');
		expect(row.error).toBe('down');
	} finally {
		await db.destroy();
	}
});

test('a repeated failure preserves failing_since so it reads as "since", not "last"', async () => {
	const db = await freshDb();
	try {
		await recordServiceOutcome(db, calendar, { at: 't1', via: 'refresh', error: 'down' });
		await recordServiceOutcome(db, calendar, { at: 't2', via: 'refresh', error: 'still down' });
		await recordServiceOutcome(db, calendar, { at: 't3', via: 'refresh', error: 'still down' });
		const row = await statusOf(db, 'calendar', 'work');
		expect(row.failing_since).toBe('t1');
		expect(row.last_attempt_at).toBe('t3');
		expect(row.error).toBe('still down');
	} finally {
		await db.destroy();
	}
});

test('recovering clears the streak and the error', async () => {
	const db = await freshDb();
	try {
		await recordServiceOutcome(db, calendar, { at: 't1', via: 'refresh', error: 'down' });
		await recordServiceOutcome(db, calendar, { at: 't2', via: 'refresh' });
		const row = await statusOf(db, 'calendar', 'work');
		expect(row.last_ok_at).toBe('t2');
		expect(row.failing_since).toBeNull();
		expect(row.error).toBeNull();
	} finally {
		await db.destroy();
	}
});

test('a manual test is recorded like any other observation, tagged by via', async () => {
	const db = await freshDb();
	try {
		await recordServiceOutcome(
			db,
			{ kind: 'provider', name: 'nextcloud' },
			{
				at: 't1',
				via: 'test'
			}
		);
		const row = await statusOf(db, 'provider', 'nextcloud');
		expect(row.last_ok_at).toBe('t1');
		expect(row.via).toBe('test');
	} finally {
		await db.destroy();
	}
});

test('keys of different kinds live side by side', async () => {
	const db = await freshDb();
	try {
		await recordServiceOutcome(db, calendar, { at: 't1', via: 'refresh' });
		await recordServiceOutcome(
			db,
			{ kind: 'provider', name: 'nextcloud' },
			{ at: 't1', via: 'test' }
		);
		await recordServiceOutcome(db, { kind: 'smtp' }, { at: 't1', via: 'send' });

		expect((await listServiceStatus(db)).map((r) => `${r.kind}/${r.name}`).sort()).toEqual([
			'calendar/work',
			'provider/nextcloud',
			'smtp/'
		]);
		expect(await listServiceStatus(db, 'calendar')).toHaveLength(1);
	} finally {
		await db.destroy();
	}
});

test('the migration carries calendar rows across, with a streak start for a failing one', async () => {
	const db = openDb(':memory:');
	const migrator = new Migrator({
		db,
		provider: {
			async getMigrations() {
				return migrations;
			}
		}
	});
	try {
		const staged = await migrator.migrateTo('0025_rename_service_name');
		expect(staged.error).toBeUndefined();

		await sql`
			INSERT INTO calendar_sync_status (calendar_id, last_refresh_at, last_successful_refresh_at, error)
			VALUES ('work', 't2', 't1', 'down'), ('home', 't3', 't3', NULL)
		`.execute(db);

		await runMigrations(db);

		const rows = (await listServiceStatus(db, 'calendar')).sort((a, b) =>
			a.name.localeCompare(b.name)
		);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			name: 'home',
			last_attempt_at: 't3',
			last_ok_at: 't3',
			failing_since: null,
			error: null,
			via: 'refresh'
		});
		expect(rows[1]).toMatchObject({
			name: 'work',
			last_attempt_at: 't2',
			last_ok_at: 't1',
			failing_since: 't2',
			error: 'down'
		});
	} finally {
		await db.destroy();
	}
});
