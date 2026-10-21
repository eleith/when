import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { sql } from 'kysely';
import { expect, test, vi } from 'vitest';
import { openDb } from './index.js';
import { withWriteTransaction } from './write-transaction.js';

async function makeDb(path = ':memory:') {
	const db = openDb(path);
	await sql`CREATE TABLE items (value integer NOT NULL)`.execute(db);
	await sql`INSERT INTO items VALUES (0)`.execute(db);
	return db;
}

async function readValue(db: ReturnType<typeof openDb>) {
	const result = await sql<{ value: number }>`SELECT value FROM items`.execute(db);
	return result.rows[0].value;
}

test('reserves the writer before reading, commits and releases it for another process', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'when-write-'));
	const path = join(directory, 'app.sqlite');
	const db = await makeDb(path);
	const workerWrite = `
		const { DatabaseSync } = require('node:sqlite');
		const db = new DatabaseSync(process.argv[1]);
		db.exec('PRAGMA busy_timeout = 0');
		db.exec('UPDATE items SET value = value + 10');
		db.close();
	`;
	try {
		const result = await withWriteTransaction(db, async (connection) => {
			const worker = spawnSync(process.execPath, ['-e', workerWrite, path], { encoding: 'utf8' });
			expect(worker.status).not.toBe(0);
			expect(worker.stderr).toContain('database is locked');
			const before = await readValue(connection);
			await sql`UPDATE items SET value = 7`.execute(connection);
			return before;
		});
		expect(result).toBe(0);
		const committed = await readValue(db);
		expect(committed).toBe(7);

		const worker = spawnSync(process.execPath, ['-e', workerWrite, path], { encoding: 'utf8' });
		expect(worker.status).toBe(0);
		const afterWorker = await readValue(db);
		expect(afterWorker).toBe(17);
	} finally {
		await db.destroy();
		await rm(directory, { recursive: true, force: true });
	}
});

test('rolls back a thrown callback and releases the connection for reuse', async () => {
	const db = await makeDb();
	try {
		const failure = new Error('abandon this edit');
		const write = withWriteTransaction(db, async (connection) => {
			await sql`UPDATE items SET value = 99`.execute(connection);
			throw failure;
		});
		await expect(write).rejects.toBe(failure);
		const rolledBack = await readValue(db);
		expect(rolledBack).toBe(0);

		await withWriteTransaction(db, async (connection) => {
			await sql`UPDATE items SET value = 2`.execute(connection);
		});
		const reused = await readValue(db);
		expect(reused).toBe(2);
	} finally {
		await db.destroy();
	}
});

test('retains the original failure when SQLite has already rolled back', async () => {
	const db = await makeDb();
	try {
		await sql`
			CREATE TRIGGER abandon_write BEFORE UPDATE ON items
			BEGIN SELECT RAISE(ROLLBACK, 'injected SQLite rollback'); END
		`.execute(db);
		const write = withWriteTransaction(db, async (connection) => {
			await sql`UPDATE items SET value = 99`.execute(connection);
		});

		const failure = await write.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(AggregateError);
		if (failure instanceof AggregateError) {
			expect(failure.cause).toMatchObject({ message: 'injected SQLite rollback' });
			expect(failure.errors).toHaveLength(2);
			expect(failure.cause).toBe(failure.errors[0]);
		}
		await sql`DROP TRIGGER abandon_write`.execute(db);
		await withWriteTransaction(db, async (connection) => {
			await sql`UPDATE items SET value = 4`.execute(connection);
		});
		const reused = await readValue(db);
		expect(reused).toBe(4);
	} finally {
		await db.destroy();
	}
});

test('failed lock acquisition does not run the callback and leaves the connection reusable', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'when-write-'));
	const path = join(directory, 'app.sqlite');
	const db = await makeDb(path);
	const worker = new DatabaseSync(path);
	try {
		await sql`PRAGMA busy_timeout = 0`.execute(db);
		worker.exec('BEGIN IMMEDIATE');
		const callback = vi.fn(async () => 'must not run');

		const write = withWriteTransaction(db, callback);

		await expect(write).rejects.toThrow('database is locked');
		expect(callback).not.toHaveBeenCalled();
		worker.exec('ROLLBACK');

		const result = await withWriteTransaction(db, async (connection) => {
			await sql`UPDATE items SET value = 3`.execute(connection);
			return 'saved';
		});
		expect(result).toBe('saved');
		const reused = await readValue(db);
		expect(reused).toBe(3);
	} finally {
		worker.close();
		await db.destroy();
		await rm(directory, { recursive: true, force: true });
	}
});
