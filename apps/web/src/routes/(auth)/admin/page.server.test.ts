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
		expect(data.publicMeetingCount).toBe(1);
		expect(data.unlistedMeetingCount).toBe(0);
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

	test('calculates lifetimeMinutes accurately without floating-point truncation', async () => {
		mockDb = await makeDb();
		await mockDb
			.insertInto('appointments')
			.values([
				{
					...baseRow,
					id: 'a1',
					start_time: '2026-09-10T14:00:00.000Z',
					end_time: '2026-09-10T14:30:00.000Z',
					status: 'confirmed',
					cancel_token: 't1'
				},
				{
					...baseRow,
					id: 'a2',
					start_time: '2026-09-10T15:00:00.000Z',
					end_time: '2026-09-10T15:45:00.000Z',
					status: 'confirmed',
					cancel_token: 't2'
				},
				{
					...baseRow,
					id: 'a3',
					start_time: '2026-09-10T16:00:00.000Z',
					end_time: '2026-09-10T17:00:00.000Z',
					status: 'confirmed',
					cancel_token: 't3'
				}
			])
			.execute();

		const data = (await load(loadEvent())) as LoadResult;
		expect(data.lifetimeMeetings).toBe(3);
		// 30 min + 45 min + 60 min = 135 min (with old julianday float cast truncation it produced 133)
		expect(data.lifetimeMinutes).toBe(135);
		expect(data.confirmedMinutesThisWeek).toBe(135);
	});

	test('lifetimeMeetings only counts confirmed meetings and excludes cancelled, declined, expired, and rescheduled', async () => {
		mockDb = await makeDb();
		await mockDb
			.insertInto('appointments')
			.values([
				{
					...baseRow,
					id: 'a1',
					start_time: '2026-09-10T10:00:00Z',
					status: 'confirmed',
					cancel_token: 't1'
				},
				{
					...baseRow,
					id: 'a2',
					start_time: '2026-09-10T11:00:00Z',
					status: 'confirmed',
					cancel_token: 't2'
				},
				{
					...baseRow,
					id: 'a3',
					start_time: '2026-09-10T12:00:00Z',
					status: 'cancelled',
					cancel_token: 't3'
				},
				{
					...baseRow,
					id: 'a4',
					start_time: '2026-09-10T13:00:00Z',
					status: 'declined',
					cancel_token: 't4'
				},
				{
					...baseRow,
					id: 'a5',
					start_time: '2026-09-10T14:00:00Z',
					status: 'expired',
					cancel_token: 't5'
				},
				{
					...baseRow,
					id: 'a6',
					start_time: '2026-09-10T15:00:00Z',
					status: 'rescheduled',
					cancel_token: 't6'
				},
				{
					...baseRow,
					id: 'a7',
					start_time: '2026-09-10T16:00:00Z',
					status: 'purged',
					cancel_token: 't7'
				},
				{
					...baseRow,
					id: 'a8',
					start_time: '2026-09-10T17:00:00Z',
					status: 'pending',
					cancel_token: 't8'
				}
			])
			.execute();

		const data = (await load(loadEvent())) as LoadResult;
		expect(data.lifetimeMeetings).toBe(2);
		expect(data.purgedCount).toBe(1);
	});

	test('totalThisMonth bounds to current month and counts only confirmed appointments', async () => {
		mockDb = await makeDb();
		const now = new Date();
		const thisMonthIso1 = new Date(now.getFullYear(), now.getMonth(), 10, 12, 0, 0).toISOString();
		const thisMonthIso2 = new Date(now.getFullYear(), now.getMonth(), 11, 12, 0, 0).toISOString();
		const thisMonthIso3 = new Date(now.getFullYear(), now.getMonth(), 12, 12, 0, 0).toISOString();
		const thisMonthIso4 = new Date(now.getFullYear(), now.getMonth(), 13, 12, 0, 0).toISOString();
		const thisMonthIso5 = new Date(now.getFullYear(), now.getMonth(), 14, 12, 0, 0).toISOString();
		const thisMonthIso6 = new Date(now.getFullYear(), now.getMonth(), 15, 12, 0, 0).toISOString();
		const thisMonthIso7 = new Date(now.getFullYear(), now.getMonth(), 16, 12, 0, 0).toISOString();
		const nextMonthIso = new Date(
			now.getFullYear(),
			now.getMonth() + 2,
			15,
			12,
			0,
			0
		).toISOString();

		await mockDb
			.insertInto('appointments')
			.values([
				{
					...baseRow,
					id: 'm1',
					start_time: thisMonthIso1,
					status: 'confirmed',
					cancel_token: 't1'
				},
				{
					...baseRow,
					id: 'm2',
					start_time: thisMonthIso2,
					status: 'cancelled',
					cancel_token: 't2'
				},
				{ ...baseRow, id: 'm3', start_time: thisMonthIso3, status: 'declined', cancel_token: 't3' },
				{ ...baseRow, id: 'm4', start_time: thisMonthIso4, status: 'expired', cancel_token: 't4' },
				{
					...baseRow,
					id: 'm5',
					start_time: thisMonthIso5,
					status: 'rescheduled',
					cancel_token: 't5'
				},
				{ ...baseRow, id: 'm6', start_time: thisMonthIso6, status: 'pending', cancel_token: 't6' },
				{
					...baseRow,
					id: 'm7',
					start_time: thisMonthIso7,
					status: 'confirmed',
					cancel_token: 't7'
				},
				{ ...baseRow, id: 'm8', start_time: nextMonthIso, status: 'confirmed', cancel_token: 't8' }
			])
			.execute();

		const data = (await load(loadEvent())) as LoadResult;
		// Only m1 and m7 (confirmed in current month) should be counted in totalThisMonth
		expect(data.totalThisMonth).toBe(2);
	});

	test('confirmedMinutesThisWeek includes appointments starting within the week window', async () => {
		mockDb = await makeDb();
		const now = new Date();
		const todayStart = new Date(now);
		todayStart.setHours(0, 0, 0, 0);
		const weekStart = new Date(todayStart);
		weekStart.setDate(weekStart.getDate() - weekStart.getDay());
		const saturdayLate = new Date(
			weekStart.getTime() + 6 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000
		);
		const sundayEarlyNextWeek = new Date(saturdayLate.getTime() + 60 * 60 * 1000);

		await mockDb
			.insertInto('appointments')
			.values([
				{
					...baseRow,
					id: 'w1',
					start_time: saturdayLate.toISOString(),
					end_time: sundayEarlyNextWeek.toISOString(),
					status: 'confirmed',
					cancel_token: 't1'
				}
			])
			.execute();

		const data = (await load(loadEvent())) as LoadResult;
		expect(data.confirmedMinutesThisWeek).toBe(60);
	});
});
