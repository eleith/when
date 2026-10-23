import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

const h = vi.hoisted(() => ({ nowMs: 0 }));
vi.mock('$lib/server/clock', () => ({ systemClock: { nowMs: () => h.nowMs } }));
vi.mock('@when/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/db')>();
	return { ...actual, getBusyIntervals: vi.fn(actual.getBusyIntervals) };
});

import {
	openDb,
	runMigrations,
	getBusyIntervals,
	replaceCalendarBusy,
	withWriteTransaction
} from '@when/db';
import { loadAvailability, isNewSlotBookable, isRescheduleSlotBookable } from './booking';

const DAY = '2030-06-03';
const CHAT = '30-min-chat';
const EDGE_START = `${DAY}T16:30:00Z`;
let db: ReturnType<typeof openDb>;

function makeConfig(durations: number[]): WhenConfiguration {
	const cfg = structuredClone(validConfig);
	cfg.user.timezone = 'UTC';
	cfg.schedules.standard.weekly = [
		{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '09:00', to: '17:00' }
	];
	cfg.meetings[CHAT].duration_minutes = durations[0];
	cfg.meetings[CHAT].additional_duration_minutes = durations.slice(1);
	cfg.meetings[CHAT].notice_minutes = 0;
	cfg.meetings[CHAT].booking_window_days = 7;
	return cfg;
}

async function book(eventTypeId: string, start: string, end: string) {
	await db
		.insertInto('appointments')
		.values({
			id: `appt-${eventTypeId}`,
			event_type_id: eventTypeId,
			start_time: start,
			end_time: end,
			guest_name: 'A',
			guest_email: 'a@example.com',
			guest_answers: null,
			location: null,
			status: 'confirmed',
			cancel_token: `tok-${eventTypeId}`,
			external_event_id: null,
			external_calendar_id: null
		})
		.execute();
}

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
	h.nowMs = Date.UTC(2030, 5, 3);
	vi.mocked(getBusyIntervals).mockClear();
});
afterEach(async () => {
	await db.destroy();
});

describe('per-duration availability', () => {
	test('precomputes one slot map per offered length', async () => {
		const cfg = makeConfig([30, 60]);
		const availability = await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT]);
		expect(availability.durations).toEqual([30, 60]);
		expect(Object.keys(availability.slotsByDuration)).toEqual(['30', '60']);
		expect(availability.slotsByDuration[30][DAY].length).toBeGreaterThan(0);
		expect(availability.slotsByDuration[60][DAY].length).toBeGreaterThan(0);
	});

	test('only the short length fits the edge of the working window', async () => {
		const cfg = makeConfig([30, 60]);
		const availability = await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT]);
		expect(availability.slotsByDuration[30][DAY]).toContain(EDGE_START);
		expect(availability.slotsByDuration[60][DAY]).not.toContain(EDGE_START);
	});

	test('both submit checks use the chosen configured length', async () => {
		const cfg = makeConfig([30, 60]);
		const meeting = cfg.meetings[CHAT];
		const newShort = await isNewSlotBookable(db, cfg, CHAT, meeting, EDGE_START, 30);
		const newLong = await isNewSlotBookable(db, cfg, CHAT, meeting, EDGE_START, 60);
		const movedShort = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			meeting,
			EDGE_START,
			30,
			`${DAY}T10:00:00Z`
		);
		const movedLong = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			meeting,
			EDGE_START,
			60,
			`${DAY}T10:00:00Z`
		);
		expect([newShort, newLong, movedShort, movedLong]).toEqual([true, false, true, false]);
	});

	test('unoffered lengths stay rejected even when they would fit', async () => {
		const cfg = makeConfig([30]);
		const meeting = cfg.meetings[CHAT];
		const created = await isNewSlotBookable(db, cfg, CHAT, meeting, `${DAY}T10:00:00Z`, 45);
		const moved = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			meeting,
			`${DAY}T10:00:00Z`,
			45,
			`${DAY}T11:00:00Z`
		);
		expect(created).toBe(false);
		expect(moved).toBe(false);
	});

	test('preserves exact offered-slot strings rather than accepting equivalent offset forms', async () => {
		const cfg = makeConfig([30]);
		const slot = `${DAY}T12:00:00+02:00`;
		const created = await isNewSlotBookable(db, cfg, CHAT, cfg.meetings[CHAT], slot, 30);
		const moved = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			cfg.meetings[CHAT],
			slot,
			30,
			`${DAY}T11:00:00Z`
		);
		expect(created).toBe(false);
		expect(moved).toBe(false);
	});

	test('reads the booking calendar as well as additional busy calendars', async () => {
		const cfg = makeConfig([30]);
		cfg.meetings[CHAT].booking_calendar = 'personal';
		cfg.meetings[CHAT].additional_busy_calendars = ['work'];
		await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT]);
		expect(vi.mocked(getBusyIntervals).mock.calls[0][1]).toEqual(['personal', 'work']);
	});

	test('a single-length meeting keeps one map', async () => {
		const cfg = makeConfig([30]);
		const availability = await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT]);
		expect(availability.durations).toEqual([30]);
		expect(Object.keys(availability.slotsByDuration)).toEqual(['30']);
	});

	test('uses a supplied transaction connection without reacquiring the database', async () => {
		const cfg = makeConfig([30]);
		const availability = await withWriteTransaction(db, async (connection) => {
			const result = await loadAvailability(connection, cfg, CHAT, cfg.meetings[CHAT]);
			return result;
		});
		expect(availability.slotsByDuration[30][DAY]).toContain(EDGE_START);
	});
});

describe('busy-data read windows', () => {
	test('picker and reschedule reads retain the full booking horizon', async () => {
		const cfg = makeConfig([30]);
		await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT]);
		await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			cfg.meetings[CHAT],
			EDGE_START,
			30,
			`${DAY}T10:00:00Z`
		);
		const windows = vi.mocked(getBusyIntervals).mock.calls.map(([, , window]) => window);
		expect(windows).toEqual([
			{ start: `${DAY}T00:00:00Z`, end: '2030-06-10T00:00:00Z' },
			{ start: `${DAY}T00:00:00Z`, end: '2030-06-10T00:00:00Z' }
		]);
	});

	test('new bookings retain local-day reads across a DST transition', async () => {
		const cfg = makeConfig([30]);
		cfg.user.timezone = 'America/New_York';
		h.nowMs = Date.UTC(2030, 2, 10);
		await isNewSlotBookable(db, cfg, CHAT, cfg.meetings[CHAT], '2030-03-10T13:00:00Z', 30);
		expect(vi.mocked(getBusyIntervals).mock.calls[0][2]).toEqual({
			start: '2030-03-10T05:00:00Z',
			end: '2030-03-11T04:00:00Z'
		});
	});

	test('preserves the existing day-versus-horizon decision at a buffered midnight boundary', async () => {
		const cfg = makeConfig([30]);
		cfg.schedules.standard.weekly[0].from = '21:00';
		cfg.schedules.standard.weekly[0].to = '23:59';
		cfg.meetings[CHAT].padding_after_minutes = 90;
		await replaceCalendarBusy(db, cfg.meetings[CHAT].booking_calendar, [
			{ start: '2030-06-04T00:15:00Z', end: '2030-06-04T00:45:00Z' }
		]);
		const slot = `${DAY}T23:00:00Z`;
		const created = await isNewSlotBookable(db, cfg, CHAT, cfg.meetings[CHAT], slot, 30);
		const moved = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			cfg.meetings[CHAT],
			slot,
			30,
			`${DAY}T21:00:00Z`
		);
		// Create's historical day read omits the next-day event; reschedule's horizon includes it.
		expect(created).toBe(true);
		expect(moved).toBe(false);
	});

	test('a remote interval overlapping the actual appointment still blocks a new booking', async () => {
		const cfg = makeConfig([30]);
		await replaceCalendarBusy(db, cfg.meetings[CHAT].booking_calendar, [
			{ start: `${DAY}T10:10:00Z`, end: `${DAY}T10:20:00Z` }
		]);
		const bookable = await isNewSlotBookable(
			db,
			cfg,
			CHAT,
			cfg.meetings[CHAT],
			`${DAY}T10:00:00Z`,
			30
		);
		expect(bookable).toBe(false);
	});
});

describe('active appointments and self-exclusion', () => {
	test('an appointment blocks other meeting types', async () => {
		const cfg = makeConfig([30]);
		cfg.meetings.lunch = { ...cfg.meetings[CHAT] };
		await book('lunch', `${DAY}T10:00:00Z`, `${DAY}T10:30:00Z`);
		const availability = await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT]);
		const bookable = await isNewSlotBookable(
			db,
			cfg,
			CHAT,
			cfg.meetings[CHAT],
			`${DAY}T10:00:00Z`,
			30
		);
		expect(availability.slotsByDuration[30][DAY]).not.toContain(`${DAY}T10:00:00Z`);
		expect(bookable).toBe(false);
	});

	test('daily limits still count only their own meeting type', async () => {
		const cfg = makeConfig([30]);
		cfg.meetings.lunch = { ...cfg.meetings[CHAT] };
		cfg.meetings[CHAT].daily_booking_limit = 1;
		await book('lunch', `${DAY}T10:00:00Z`, `${DAY}T10:30:00Z`);
		const availability = await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT]);
		expect(availability.slotsByDuration[30][DAY].length).toBeGreaterThan(0);
		expect(availability.slotsByDuration[30][DAY]).not.toContain(`${DAY}T10:00:00Z`);
	});

	test('rescheduling excludes itself, not another meeting type', async () => {
		const cfg = makeConfig([30]);
		cfg.meetings.lunch = { ...cfg.meetings[CHAT] };
		await book(CHAT, `${DAY}T10:00:00Z`, `${DAY}T10:30:00Z`);
		await book('lunch', `${DAY}T11:00:00Z`, `${DAY}T11:30:00Z`);
		const own = `${DAY}T10:00:00Z`;
		const ownSlot = await isRescheduleSlotBookable(db, cfg, CHAT, cfg.meetings[CHAT], own, 30, own);
		const otherSlot = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			cfg.meetings[CHAT],
			`${DAY}T11:00:00Z`,
			30,
			own
		);
		expect(ownSlot).toBe(true);
		expect(otherSlot).toBe(false);
	});

	test('self-exclusion does not change the existing daily count', async () => {
		const cfg = makeConfig([30]);
		cfg.meetings[CHAT].daily_booking_limit = 1;
		const own = `${DAY}T10:00:00Z`;
		await book(CHAT, own, `${DAY}T10:30:00Z`);
		const moved = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			cfg.meetings[CHAT],
			`${DAY}T13:00:00Z`,
			30,
			own
		);
		expect(moved).toBe(false);
	});
});
