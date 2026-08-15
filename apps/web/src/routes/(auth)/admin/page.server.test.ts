import { describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations } from '@when/db';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

let mockDb: Awaited<ReturnType<typeof makeDb>> | null = null;
vi.mock('$lib/server/state', () => ({
	getDb: () => {
		if (!mockDb) throw new Error('mockDb not initialized');
		return mockDb;
	},
	getConfig: () => validConfig
}));

import { load } from './+page.server';

type LoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;

const baseRow = {
	event_type_id: '30-min-chat',
	start_time: '2099-01-01T15:00:00Z',
	end_time: '2099-01-01T15:30:00Z',
	guest_name: 'Booker',
	guest_email: 'booker@example.com',
	guest_answers: null,
	location: null,
	external_event_id: null,
	external_calendar_id: null
};

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

function loadEvent(): Parameters<typeof load>[0] {
	return {} as Parameters<typeof load>[0];
}

describe('admin +page.server load', () => {
	test('returns purgedCount: 0 when no purged appointments exist', async () => {
		mockDb = await makeDb();
		await mockDb
			.insertInto('appointments')
			.values({
				...baseRow,
				id: 'a1',
				status: 'confirmed',
				cancel_token: 't1'
			})
			.execute();

		const data = (await load(loadEvent())) as LoadResult;
		expect(data.purgedCount).toBe(0);
		expect(data.lifetimeMeetings).toBe(1);
	});

	test('returns correct purgedCount when purged appointments exist', async () => {
		mockDb = await makeDb();
		await mockDb
			.insertInto('appointments')
			.values([
				{ ...baseRow, id: 'a1', status: 'confirmed', cancel_token: 't1' },
				{ ...baseRow, id: 'a2', status: 'purged', cancel_token: 't2' },
				{ ...baseRow, id: 'a3', status: 'purged', cancel_token: 't3' }
			])
			.execute();

		const data = (await load(loadEvent())) as LoadResult;
		expect(data.purgedCount).toBe(2);
		expect(data.lifetimeMeetings).toBe(1);
	});
});
