import { expect, test } from 'vitest';
import { sql } from 'kysely';
import { openDb } from '../../src/lib/server/db';

test('openDb returns a Kysely instance backed by node:sqlite', async () => {
	const db = openDb(':memory:');
	const result = await sql<{ v: number }>`select 1 as v`.execute(db);
	expect(result.rows[0]?.v).toBe(1);
	await db.destroy();
});
