import { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';
import { Kysely, sql } from 'kysely';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { NodeSqliteDialect } from './node-sqlite-dialect.js';

interface TestDatabase {
	items: { id: number; value: number };
}

let database: DatabaseSync;
let db: Kysely<TestDatabase>;

beforeEach(async () => {
	database = new DatabaseSync(':memory:');
	db = new Kysely<TestDatabase>({ dialect: new NodeSqliteDialect({ database }) });
	await sql`create table items (id integer primary key, value integer not null)`.execute(db);
	await db
		.insertInto('items')
		.values([
			{ id: 1, value: 0 },
			{ id: 2, value: 0 }
		])
		.execute();
});

afterEach(async () => {
	await db.destroy();
});

test('overlapping transactions wait for connection release and observe committed data', async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const first = db.transaction().execute(async (trx) => {
		await trx.updateTable('items').set({ value: 10 }).where('id', '=', 1).execute();
		entered.resolve();
		await release.promise;
	});
	const firstOutcome = Promise.allSettled([first]);
	await entered.promise;

	let secondEntered = false;
	const second = db.transaction().execute(async (trx) => {
		secondEntered = true;
		const row = await trx
			.selectFrom('items')
			.selectAll()
			.where('id', '=', 1)
			.executeTakeFirstOrThrow();
		await trx
			.updateTable('items')
			.set({ value: row.value + 1 })
			.where('id', '=', 1)
			.execute();
		return row.value;
	});
	const secondOutcome = Promise.allSettled([second]);

	try {
		await setImmediate();
		expect(secondEntered).toBe(false);
	} finally {
		release.resolve();
		await firstOutcome;
		await secondOutcome;
	}

	const firstResults = await firstOutcome;
	const secondResults = await secondOutcome;
	expect(firstResults).toEqual([{ status: 'fulfilled', value: undefined }]);
	expect(secondResults).toEqual([{ status: 'fulfilled', value: 10 }]);
	const row = await db
		.selectFrom('items')
		.selectAll()
		.where('id', '=', 1)
		.executeTakeFirstOrThrow();
	expect(row.value).toBe(11);
});

test('ordinary UPDATE and SELECT wait outside a failing transaction and survive its rollback', async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const failure = new Error('roll back this request only');
	const transaction = db.transaction().execute(async (trx) => {
		await trx.updateTable('items').set({ value: 99 }).where('id', '=', 1).execute();
		entered.resolve();
		await release.promise;
		throw failure;
	});
	const transactionOutcome = Promise.allSettled([transaction]);
	await entered.promise;

	let updateCompleted = false;
	let selectCompleted = false;
	const update = db
		.updateTable('items')
		.set({ value: 7 })
		.where('id', '=', 2)
		.executeTakeFirstOrThrow()
		.then((result) => {
			updateCompleted = true;
			return result.numUpdatedRows;
		});
	const select = db
		.selectFrom('items')
		.select('value')
		.where('id', '=', 1)
		.executeTakeFirstOrThrow()
		.then((row) => {
			selectCompleted = true;
			return row.value;
		});
	const queryOutcomes = Promise.allSettled([update, select]);

	try {
		await setImmediate();
		expect(updateCompleted).toBe(false);
		expect(selectCompleted).toBe(false);
	} finally {
		release.resolve();
		await transactionOutcome;
		await queryOutcomes;
	}

	const transactionResults = await transactionOutcome;
	const queryResults = await queryOutcomes;
	expect(transactionResults).toEqual([{ status: 'rejected', reason: failure }]);
	expect(queryResults).toEqual([
		{ status: 'fulfilled', value: 1n },
		{ status: 'fulfilled', value: 0 }
	]);
	const rows = await db.selectFrom('items').selectAll().orderBy('id').execute();
	expect(rows).toEqual([
		{ id: 1, value: 0 },
		{ id: 2, value: 7 }
	]);

	await db.transaction().execute(async (trx) => {
		await trx.updateTable('items').set({ value: 8 }).where('id', '=', 2).execute();
	});
	const row = await db
		.selectFrom('items')
		.selectAll()
		.where('id', '=', 2)
		.executeTakeFirstOrThrow();
	expect(row.value).toBe(8);
});

test('reads SELECT, PRAGMA and CTE result columns without guessing from SQL text', async () => {
	const selected = await sql<{
		value: string;
	}>`/* leading comment */ select ${'bound'} as value`.execute(db);
	expect(selected.rows).toEqual([{ value: 'bound' }]);
	const pragma = await sql<{ name: string }>`pragma table_info(items)`.execute(db);
	expect(pragma.rows.map((column) => column.name)).toEqual(['id', 'value']);
	const cte = await sql<{ value: number }>`
		with chosen as (select value from items where id = ${1})
		select value from chosen
	`.execute(db);
	expect(cte.rows).toEqual([{ value: 0 }]);
});

test('returns DML rows, affected row counts and insert IDs using statement metadata', async () => {
	const inserted = await db
		.insertInto('items')
		.values({ id: 3, value: 30 })
		.executeTakeFirstOrThrow();
	expect(inserted.insertId).toBe(3n);
	expect(inserted.numInsertedOrUpdatedRows).toBe(1n);
	const returning = await db
		.updateTable('items')
		.set({ value: 31 })
		.where('id', '=', 3)
		.returningAll()
		.execute();
	expect(returning).toEqual([{ id: 3, value: 31 }]);
	const updated = await sql`
		with increment as (select ${4} as amount)
		update items set value = value + (select amount from increment) where id = ${2}
	`.execute(db);
	expect(updated.numAffectedRows).toBe(1n);
	expect(updated.rows).toEqual([]);
	const commented =
		await sql`/* returning is not a result clause */ update items set value = ${5} where id = ${1}`.execute(
			db
		);
	expect(commented.numAffectedRows).toBe(1n);
	const deleted = await db.deleteFrom('items').where('id', '=', 3).executeTakeFirstOrThrow();
	expect(deleted.numDeletedRows).toBe(1n);
	const rows = await db.selectFrom('items').selectAll().orderBy('id').execute();
	expect(rows).toEqual([
		{ id: 1, value: 5 },
		{ id: 2, value: 4 }
	]);
});

test('streams SELECT rows with bound parameters through the native iterator', async () => {
	const rows = [];
	for await (const row of db
		.selectFrom('items')
		.selectAll()
		.where('id', '>', 1)
		.orderBy('id')
		.stream()) {
		rows.push(row);
	}
	expect(rows).toEqual([{ id: 2, value: 0 }]);
});

test('destroy closes the supplied Node SQLite database', async () => {
	await db.destroy();
	expect(database.isOpen).toBe(false);
});
