import { expect, test } from 'bun:test';
import { loadDateOverrides } from '../src/lib/server/availability/db-overrides';
import { openDb } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/db/migrate';

async function freshDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

test('returns empty map when no overrides exist', async () => {
	const db = await freshDb();
	try {
		const map = await loadDateOverrides(db, '2026-04-01', '2026-04-30');
		expect(map.size).toBe(0);
	} finally {
		await db.destroy();
	}
});

test('null start/end maps to allDayBlock', async () => {
	const db = await freshDb();
	try {
		await db
			.insertInto('availability_overrides')
			.values({ id: '1', date: '2026-04-15', start_time: null, end_time: null, reason: 'OOO' })
			.execute();
		const map = await loadDateOverrides(db, '2026-04-01', '2026-04-30');
		expect(map.get('2026-04-15')).toEqual({ allDayBlock: true });
	} finally {
		await db.destroy();
	}
});

test('non-null start/end maps to window override', async () => {
	const db = await freshDb();
	try {
		await db
			.insertInto('availability_overrides')
			.values({
				id: '2',
				date: '2026-04-16',
				start_time: '13:00',
				end_time: '17:00',
				reason: 'late start'
			})
			.execute();
		const map = await loadDateOverrides(db, '2026-04-01', '2026-04-30');
		expect(map.get('2026-04-16')).toEqual({ window: { start: '13:00', end: '17:00' } });
	} finally {
		await db.destroy();
	}
});

test('respects the date range bounds', async () => {
	const db = await freshDb();
	try {
		await db
			.insertInto('availability_overrides')
			.values([
				{ id: 'a', date: '2026-03-31', start_time: null, end_time: null, reason: null },
				{ id: 'b', date: '2026-04-15', start_time: null, end_time: null, reason: null },
				{ id: 'c', date: '2026-05-01', start_time: null, end_time: null, reason: null }
			])
			.execute();
		const map = await loadDateOverrides(db, '2026-04-01', '2026-04-30');
		expect(map.size).toBe(1);
		expect(map.has('2026-04-15')).toBe(true);
	} finally {
		await db.destroy();
	}
});
