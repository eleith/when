import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Kysely } from 'kysely';
import type { Database } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

const h = vi.hoisted(() => ({ db: null as unknown as Kysely<Database>, nowMs: 0 }));

vi.mock('$lib/server/state', () => ({ getDb: () => h.db }));
vi.mock('$lib/server/clock', () => ({ systemClock: { nowMs: () => h.nowMs } }));
vi.mock('@when/db', async (importOriginal) => ({
	...(await importOriginal<typeof import('@when/db')>()),
	getBusyIntervals: vi.fn(async () => [])
}));

import { openDb, runMigrations, getBusyIntervals } from '@when/db';
import { loadAvailability, isSlotBookable } from './load';

// A day whose whole 09:00–17:00 UTC window sits ahead of "now" (00:00 UTC).
const DAY = '2030-06-03';
const CHAT = '30-min-chat';
// 16:30 fits a 30-min meeting (ends 17:00) but not a 60-min one (ends 17:30, past the window).
const EDGE_START = `${DAY}T16:30:00Z`;

function makeConfig(durations: number[]): WhenConfiguration {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
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

describe('loadAvailability per-duration slots', () => {
	beforeEach(async () => {
		h.db = openDb(':memory:');
		await runMigrations(h.db);
		h.nowMs = Date.UTC(2030, 5, 3, 0, 0, 0); // 2030-06-03T00:00:00Z
	});

	afterEach(async () => {
		await h.db.destroy();
	});

	test('precomputes one slot set per offered length', async () => {
		const cfg = makeConfig([30, 60]);
		const { durations, slotsByDuration } = await loadAvailability(cfg, CHAT, cfg.meetings[CHAT]);
		expect(durations).toEqual([30, 60]);
		expect(Object.keys(slotsByDuration)).toEqual(['30', '60']);
		expect(slotsByDuration[30][DAY].length).toBeGreaterThan(0);
		expect(slotsByDuration[60][DAY].length).toBeGreaterThan(0);
	});

	test('a start that fits the short length but not the long one is only in the short set', async () => {
		const cfg = makeConfig([30, 60]);
		const { slotsByDuration } = await loadAvailability(cfg, CHAT, cfg.meetings[CHAT]);
		expect(slotsByDuration[30][DAY]).toContain(EDGE_START);
		expect(slotsByDuration[60][DAY]).not.toContain(EDGE_START);
	});

	test('isSlotBookable answers per chosen length', async () => {
		const cfg = makeConfig([30, 60]);
		const et = cfg.meetings[CHAT];
		expect(await isSlotBookable(cfg, CHAT, et, EDGE_START, 30)).toBe(true);
		expect(await isSlotBookable(cfg, CHAT, et, EDGE_START, 60)).toBe(false);
	});

	test('the busy lookup covers the booking calendar, not only the listed ones', async () => {
		const cfg = makeConfig([30]);
		cfg.meetings[CHAT].booking_calendar = 'personal';
		cfg.meetings[CHAT].additional_busy_calendars = ['work'];
		vi.mocked(getBusyIntervals).mockClear();

		await loadAvailability(cfg, CHAT, cfg.meetings[CHAT]);

		expect(vi.mocked(getBusyIntervals).mock.calls[0][1]).toEqual(['personal', 'work']);
	});

	test('a single-length meeting keys the map by that one length', async () => {
		const cfg = makeConfig([30]);
		const { durations, slotsByDuration } = await loadAvailability(cfg, CHAT, cfg.meetings[CHAT]);
		expect(durations).toEqual([30]);
		expect(Object.keys(slotsByDuration)).toEqual(['30']);
	});
});

describe('loadAvailability across meeting types', () => {
	beforeEach(async () => {
		h.db = openDb(':memory:');
		await runMigrations(h.db);
		h.nowMs = Date.UTC(2030, 5, 3, 0, 0, 0);
	});

	afterEach(async () => {
		await h.db.destroy();
	});

	// A second meeting type sharing the schedule, so both offer the same slots.
	function withTwoTypes(): WhenConfiguration {
		const cfg = makeConfig([30]);
		cfg.meetings.lunch = { ...cfg.meetings[CHAT] };
		return cfg;
	}

	async function book(eventTypeId: string, start: string, end: string) {
		await h.db
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

	test('an appointment on one meeting type removes the slot from another', async () => {
		const cfg = withTwoTypes();
		await book('lunch', `${DAY}T10:00:00Z`, `${DAY}T10:30:00Z`);

		const { slotsByDuration } = await loadAvailability(cfg, CHAT, cfg.meetings[CHAT]);
		expect(slotsByDuration[30][DAY]).not.toContain(`${DAY}T10:00:00Z`);
		expect(await isSlotBookable(cfg, CHAT, cfg.meetings[CHAT], `${DAY}T10:00:00Z`, 30)).toBe(false);
	});

	test('daily_booking_limit still counts only its own meeting type', async () => {
		const cfg = withTwoTypes();
		cfg.meetings[CHAT].daily_booking_limit = 1;
		await book('lunch', `${DAY}T10:00:00Z`, `${DAY}T10:30:00Z`);

		// The lunch booking blocks its own slot but does not consume the chat quota.
		const { slotsByDuration } = await loadAvailability(cfg, CHAT, cfg.meetings[CHAT]);
		expect(slotsByDuration[30][DAY].length).toBeGreaterThan(0);
		expect(slotsByDuration[30][DAY]).not.toContain(`${DAY}T10:00:00Z`);
	});

	test('a reschedule may reclaim its own slot but not another type’s', async () => {
		const cfg = withTwoTypes();
		await book('30-min-chat', `${DAY}T10:00:00Z`, `${DAY}T10:30:00Z`);
		await book('lunch', `${DAY}T11:00:00Z`, `${DAY}T11:30:00Z`);

		const own = `${DAY}T10:00:00Z`;
		expect(await isSlotBookable(cfg, CHAT, cfg.meetings[CHAT], own, 30, own)).toBe(true);
		expect(await isSlotBookable(cfg, CHAT, cfg.meetings[CHAT], `${DAY}T11:00:00Z`, 30, own)).toBe(
			false
		);
	});
});
