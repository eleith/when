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

import { openDb, runMigrations } from '@when/db';
import { loadAvailability, isSlotBookable } from './load';

// A day whose whole 09:00–17:00 UTC window sits ahead of "now" (00:00 UTC).
const DAY = '2030-06-03';
// 16:30 fits a 30-min meeting (ends 17:00) but not a 60-min one (ends 17:30, past the window).
const EDGE_START = `${DAY}T16:30:00Z`;

function makeConfig(durations: number[]): WhenConfiguration {
	const cfg: WhenConfiguration = JSON.parse(JSON.stringify(validConfig));
	cfg.user.timezone = 'UTC';
	cfg.schedules[0].weekly = [
		{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '09:00', to: '17:00' }
	];
	cfg.meetings[0].duration_minutes = durations;
	cfg.meetings[0].notice_minutes = 0;
	cfg.meetings[0].booking_window_days = 7;
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
		const { durations, slotsByDuration } = await loadAvailability(cfg, cfg.meetings[0]);
		expect(durations).toEqual([30, 60]);
		expect(Object.keys(slotsByDuration)).toEqual(['30', '60']);
		expect(slotsByDuration[30][DAY].length).toBeGreaterThan(0);
		expect(slotsByDuration[60][DAY].length).toBeGreaterThan(0);
	});

	test('a start that fits the short length but not the long one is only in the short set', async () => {
		const cfg = makeConfig([30, 60]);
		const { slotsByDuration } = await loadAvailability(cfg, cfg.meetings[0]);
		expect(slotsByDuration[30][DAY]).toContain(EDGE_START);
		expect(slotsByDuration[60][DAY]).not.toContain(EDGE_START);
	});

	test('isSlotBookable answers per chosen length', async () => {
		const cfg = makeConfig([30, 60]);
		const et = cfg.meetings[0];
		expect(await isSlotBookable(cfg, et, EDGE_START, 30)).toBe(true);
		expect(await isSlotBookable(cfg, et, EDGE_START, 60)).toBe(false);
	});

	test('a single-length meeting keys the map by that one length', async () => {
		const cfg = makeConfig([30]);
		const { durations, slotsByDuration } = await loadAvailability(cfg, cfg.meetings[0]);
		expect(durations).toEqual([30]);
		expect(Object.keys(slotsByDuration)).toEqual(['30']);
	});
});
