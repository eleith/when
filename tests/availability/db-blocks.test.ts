import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Temporal } from '@js-temporal/polyfill';
import type { Kysely } from 'kysely';
import { loadAppointmentBlocks } from '../../src/lib/server/availability/db-blocks';
import { openDb, type Database } from '../../src/lib/server/db';
import { runMigrations } from '../../src/lib/server/db/migrate';

let db: Kysely<Database>;

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
});
afterEach(async () => {
	await db.destroy();
});

const I = (s: string) => Temporal.Instant.from(s);

async function insert(row: {
	id: string;
	start: string;
	end: string;
	status: 'pending' | 'confirmed' | 'declined' | 'cancelled';
	cancel_token?: string;
	event_type_id?: string;
}) {
	await db
		.insertInto('appointments')
		.values({
			id: row.id,
			event_type_id: row.event_type_id ?? 'chat',
			start_time: row.start,
			end_time: row.end,
			attendee_name: 'A',
			attendee_email: 'a@example.com',
			attendee_notes: null,
			location: null,
			status: row.status,
			cancel_token: row.cancel_token ?? `tok-${row.id}`,
			external_event_id: null,
			external_calendar_id: null,
			notification_status: null
		})
		.execute();
}

test('empty db returns empty blocks', async () => {
	const result = await loadAppointmentBlocks(
		db,
		'chat',
		I('2026-05-01T00:00:00Z'),
		I('2026-05-01T23:59:59Z'),
		'America/New_York'
	);
	expect(result.appointments).toEqual([]);
	expect(result.perDayCount.size).toBe(0);
});

test('active appointments are returned; cancelled/declined are not', async () => {
	await insert({
		id: '1',
		start: '2026-05-01T13:00:00Z',
		end: '2026-05-01T13:30:00Z',
		status: 'confirmed'
	});
	await insert({
		id: '2',
		start: '2026-05-01T14:00:00Z',
		end: '2026-05-01T14:30:00Z',
		status: 'pending'
	});
	await insert({
		id: '3',
		start: '2026-05-01T15:00:00Z',
		end: '2026-05-01T15:30:00Z',
		status: 'cancelled'
	});
	await insert({
		id: '4',
		start: '2026-05-01T16:00:00Z',
		end: '2026-05-01T16:30:00Z',
		status: 'declined'
	});

	const result = await loadAppointmentBlocks(
		db,
		'chat',
		I('2026-05-01T00:00:00Z'),
		I('2026-05-01T23:59:59Z'),
		'America/New_York'
	);
	expect(result.appointments).toHaveLength(2);
	expect(result.appointments.map((a) => a.start.toString()).sort()).toEqual([
		'2026-05-01T13:00:00Z',
		'2026-05-01T14:00:00Z'
	]);
});

test('appointments outside the range (with 1-day margin) are excluded', async () => {
	await insert({
		id: '1',
		start: '2026-04-25T13:00:00Z', // 6 days before range
		end: '2026-04-25T13:30:00Z',
		status: 'confirmed'
	});
	await insert({
		id: '2',
		start: '2026-05-01T13:00:00Z',
		end: '2026-05-01T13:30:00Z',
		status: 'confirmed'
	});

	const result = await loadAppointmentBlocks(
		db,
		'chat',
		I('2026-05-01T00:00:00Z'),
		I('2026-05-01T23:59:59Z'),
		'America/New_York'
	);
	expect(result.appointments).toHaveLength(1);
	expect(result.appointments[0].start.toString()).toBe('2026-05-01T13:00:00Z');
});

test('different event_type_id is excluded', async () => {
	await insert({
		id: '1',
		start: '2026-05-01T13:00:00Z',
		end: '2026-05-01T13:30:00Z',
		status: 'confirmed',
		event_type_id: 'lunch'
	});

	const result = await loadAppointmentBlocks(
		db,
		'chat',
		I('2026-05-01T00:00:00Z'),
		I('2026-05-01T23:59:59Z'),
		'America/New_York'
	);
	expect(result.appointments).toHaveLength(0);
});

test('perDayCount keys by user_tz date, not UTC', async () => {
	// 23:30 UTC on 2026-05-01 = 19:30 NYC on 2026-05-01 = 08:30 Tokyo on 2026-05-02
	await insert({
		id: '1',
		start: '2026-05-01T23:30:00Z',
		end: '2026-05-02T00:00:00Z',
		status: 'confirmed'
	});

	const nyc = await loadAppointmentBlocks(
		db,
		'chat',
		I('2026-05-01T00:00:00Z'),
		I('2026-05-02T23:59:59Z'),
		'America/New_York'
	);
	expect([...nyc.perDayCount.entries()]).toEqual([['2026-05-01', 1]]);

	const tokyo = await loadAppointmentBlocks(
		db,
		'chat',
		I('2026-05-01T00:00:00Z'),
		I('2026-05-02T23:59:59Z'),
		'Asia/Tokyo'
	);
	expect([...tokyo.perDayCount.entries()]).toEqual([['2026-05-02', 1]]);
});
