import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';
import { validConfig } from '#lib/server/__fixtures__/valid-config.js';
import { resolveBookingDurations, resolveDuration } from '../appointment/duration';

const h = vi.hoisted(() => ({ nowMs: 0 }));
vi.mock('#lib/server/clock.js', () => ({ systemClock: { nowMs: () => h.nowMs } }));
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

function currentAppointment(
	start: string,
	minutes = 30
): Pick<Appointment, 'start_time' | 'end_time'> {
	const instant = Temporal.Instant.from(start);
	return { start_time: start, end_time: instant.add({ minutes }).toString() };
}

function durationForm(duration?: number): FormData {
	const form = new FormData();
	if (duration !== undefined) form.set('duration', String(duration));
	return form;
}

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
		const availability = await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT], 'guest');
		expect(availability.bookingDurations).toEqual({ defaultDuration: 30, durations: [30, 60] });
		expect(availability).not.toHaveProperty('durations');
		expect(Object.keys(availability.slotsByDuration)).toEqual(['30', '60']);
		expect(availability.slotsByDuration[30][DAY].length).toBeGreaterThan(0);
		expect(availability.slotsByDuration[60][DAY].length).toBeGreaterThan(0);
	});

	test('only the short length fits the edge of the working window', async () => {
		const cfg = makeConfig([30, 60]);
		const availability = await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT], 'guest');
		expect(availability.slotsByDuration[30][DAY]).toContain(EDGE_START);
		expect(availability.slotsByDuration[60][DAY]).not.toContain(EDGE_START);
	});

	test('both submit checks use the chosen configured length', async () => {
		const cfg = makeConfig([30, 60]);
		const meeting = cfg.meetings[CHAT];
		const newShort = await isNewSlotBookable(db, cfg, CHAT, meeting, 'guest', EDGE_START, 30);
		const newLong = await isNewSlotBookable(db, cfg, CHAT, meeting, 'guest', EDGE_START, 60);
		const movedShort = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			meeting,
			'guest',
			EDGE_START,
			30,
			currentAppointment(`${DAY}T10:00:00Z`)
		);
		const movedLong = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			meeting,
			'guest',
			EDGE_START,
			60,
			currentAppointment(`${DAY}T10:00:00Z`)
		);
		expect([newShort, newLong, movedShort, movedLong]).toEqual([true, false, true, false]);
	});

	test('unoffered lengths stay rejected even when they would fit', async () => {
		const cfg = makeConfig([30]);
		const meeting = cfg.meetings[CHAT];
		const created = await isNewSlotBookable(
			db,
			cfg,
			CHAT,
			meeting,
			'guest',
			`${DAY}T10:00:00Z`,
			45
		);
		const moved = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			meeting,
			'guest',
			`${DAY}T10:00:00Z`,
			45,
			currentAppointment(`${DAY}T11:00:00Z`)
		);
		expect(created).toBe(false);
		expect(moved).toBe(false);
	});

	test('preserves exact offered-slot strings rather than accepting equivalent offset forms', async () => {
		const cfg = makeConfig([30]);
		const slot = `${DAY}T12:00:00+02:00`;
		const created = await isNewSlotBookable(db, cfg, CHAT, cfg.meetings[CHAT], 'guest', slot, 30);
		const moved = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			cfg.meetings[CHAT],
			'guest',
			slot,
			30,
			currentAppointment(`${DAY}T11:00:00Z`)
		);
		expect(created).toBe(false);
		expect(moved).toBe(false);
	});

	test('reads the booking calendar as well as additional busy calendars', async () => {
		const cfg = makeConfig([30]);
		cfg.meetings[CHAT].booking_calendar = 'personal';
		cfg.meetings[CHAT].additional_busy_calendars = ['work'];
		await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT], 'guest');
		expect(vi.mocked(getBusyIntervals).mock.calls[0][1]).toEqual(['personal', 'work']);
	});

	test('a single-length meeting keeps one map', async () => {
		const cfg = makeConfig([30]);
		const availability = await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT], 'guest');
		expect(availability.bookingDurations).toEqual({ defaultDuration: 30, durations: [30] });
		expect(Object.keys(availability.slotsByDuration)).toEqual(['30']);
	});

	test('uses a supplied transaction connection without reacquiring the database', async () => {
		const cfg = makeConfig([30]);
		const availability = await withWriteTransaction(db, async (connection) => {
			const result = await loadAvailability(connection, cfg, CHAT, cfg.meetings[CHAT], 'guest');
			return result;
		});
		expect(availability.slotsByDuration[30][DAY]).toContain(EDGE_START);
	});
});

describe('busy-data read windows', () => {
	test('picker and reschedule reads retain the full booking horizon', async () => {
		const cfg = makeConfig([30]);
		await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT], 'guest');
		await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			cfg.meetings[CHAT],
			'guest',
			EDGE_START,
			30,
			currentAppointment(`${DAY}T10:00:00Z`)
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
		await isNewSlotBookable(db, cfg, CHAT, cfg.meetings[CHAT], 'guest', '2030-03-10T13:00:00Z', 30);
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
		const created = await isNewSlotBookable(db, cfg, CHAT, cfg.meetings[CHAT], 'guest', slot, 30);
		const moved = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			cfg.meetings[CHAT],
			'guest',
			slot,
			30,
			currentAppointment(`${DAY}T21:00:00Z`)
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
			'guest',
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
		const availability = await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT], 'guest');
		const bookable = await isNewSlotBookable(
			db,
			cfg,
			CHAT,
			cfg.meetings[CHAT],
			'guest',
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
		const availability = await loadAvailability(db, cfg, CHAT, cfg.meetings[CHAT], 'guest');
		expect(availability.slotsByDuration[30][DAY].length).toBeGreaterThan(0);
		expect(availability.slotsByDuration[30][DAY]).not.toContain(`${DAY}T10:00:00Z`);
	});

	test('rescheduling excludes itself, not another meeting type', async () => {
		const cfg = makeConfig([30]);
		cfg.meetings.lunch = { ...cfg.meetings[CHAT] };
		await book(CHAT, `${DAY}T10:00:00Z`, `${DAY}T10:30:00Z`);
		await book('lunch', `${DAY}T11:00:00Z`, `${DAY}T11:30:00Z`);
		const own = `${DAY}T10:00:00Z`;
		const ownSlot = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			cfg.meetings[CHAT],
			'guest',
			own,
			30,
			currentAppointment(own)
		);
		const otherSlot = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			cfg.meetings[CHAT],
			'guest',
			`${DAY}T11:00:00Z`,
			30,
			currentAppointment(own)
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
			'guest',
			`${DAY}T13:00:00Z`,
			30,
			currentAppointment(own)
		);
		expect(moved).toBe(false);
	});
});

describe('role-specific availability limits', () => {
	test.each([
		['before', '09:30'],
		['after', '10:30']
	])('only hosts can book adjacent %s an existing appointment', async (_side, time) => {
		const cfg = makeConfig([30]);
		const meeting = cfg.meetings[CHAT];
		meeting.padding_before_minutes = 15;
		meeting.padding_after_minutes = 15;
		await book(CHAT, `${DAY}T10:00:00Z`, `${DAY}T10:30:00Z`);
		const slot = `${DAY}T${time}:00Z`;

		for (const role of ['guest', 'host'] as const) {
			const availability = await loadAvailability(db, cfg, CHAT, meeting, role);
			const created = await isNewSlotBookable(db, cfg, CHAT, meeting, role, slot, 30);
			const moved = await isRescheduleSlotBookable(
				db,
				cfg,
				CHAT,
				meeting,
				role,
				slot,
				30,
				currentAppointment(`${DAY}T14:00:00Z`)
			);
			const expected = role === 'host';
			expect(availability.slotsByDuration[30][DAY].includes(slot), role).toBe(expected);
			expect([created, moved], role).toEqual([expected, expected]);
		}
	});

	test.each(['appointment', 'remote'] as const)(
		'actual overlap with a foreign %s blocks both roles',
		async (source) => {
			const cfg = makeConfig([30]);
			const meeting = cfg.meetings[CHAT];
			meeting.padding_before_minutes = 15;
			meeting.padding_after_minutes = 15;
			const slot = `${DAY}T10:00:00Z`;
			if (source === 'appointment') {
				cfg.meetings.lunch = { ...meeting };
				await book('lunch', slot, `${DAY}T10:30:00Z`);
			} else {
				meeting.additional_busy_calendars = ['foreign'];
				await replaceCalendarBusy(db, 'foreign', [
					{ start: `${DAY}T10:10:00Z`, end: `${DAY}T10:20:00Z` }
				]);
			}

			for (const role of ['guest', 'host'] as const) {
				const availability = await loadAvailability(db, cfg, CHAT, meeting, role);
				const created = await isNewSlotBookable(db, cfg, CHAT, meeting, role, slot, 30);
				const moved = await isRescheduleSlotBookable(
					db,
					cfg,
					CHAT,
					meeting,
					role,
					slot,
					30,
					currentAppointment(slot)
				);
				expect(availability.slotsByDuration[30][DAY], role).not.toContain(slot);
				expect([created, moved], role).toEqual([false, false]);
			}
		}
	);

	test('host-created appointments still block guests and count toward their daily cap, including self-exclusion', async () => {
		const cfg = makeConfig([30]);
		const meeting = cfg.meetings[CHAT];
		meeting.daily_booking_limit = 1;
		const own = `${DAY}T10:00:00Z`;
		const free = `${DAY}T13:00:00Z`;
		await book(CHAT, own, `${DAY}T10:30:00Z`);
		await db
			.updateTable('appointments')
			.set({
				action_log: JSON.stringify([{ action: 'create', actor: 'host', at: `${DAY}T00:00:00Z` }])
			})
			.where('id', '=', `appt-${CHAT}`)
			.execute();

		const current = currentAppointment(own);
		for (const role of ['guest', 'host'] as const) {
			const availability = await loadAvailability(db, cfg, CHAT, meeting, role);
			const rescheduleAvailability = await loadAvailability(db, cfg, CHAT, meeting, role, current);
			const created = await isNewSlotBookable(db, cfg, CHAT, meeting, role, free, 30);
			const moved = await isRescheduleSlotBookable(db, cfg, CHAT, meeting, role, free, 30, current);
			const occupied = await isNewSlotBookable(db, cfg, CHAT, meeting, role, own, 30);
			const retained = await isRescheduleSlotBookable(
				db,
				cfg,
				CHAT,
				meeting,
				role,
				own,
				30,
				current
			);
			const expected = role === 'host';
			if (role === 'guest') {
				expect(availability.slotsByDuration[30][DAY]).toBeUndefined();
				expect(rescheduleAvailability.slotsByDuration[30][DAY]).toBeUndefined();
			} else {
				expect(availability.slotsByDuration[30][DAY]).toContain(free);
				expect(availability.slotsByDuration[30][DAY]).not.toContain(own);
				expect(rescheduleAvailability.slotsByDuration[30][DAY]).toContain(own);
				expect(rescheduleAvailability.slotsByDuration[30][DAY]).toContain(free);
			}
			expect([created, moved, occupied, retained], role).toEqual([
				expected,
				expected,
				false,
				expected
			]);
		}

		// Removing the cap leaves the host-created row's actual busy interval intact.
		meeting.daily_booking_limit = null;
		const uncappedGuest = await loadAvailability(db, cfg, CHAT, meeting, 'guest');
		expect(uncappedGuest.slotsByDuration[30][DAY]).toContain(free);
		expect(uncappedGuest.slotsByDuration[30][DAY]).not.toContain(own);
	});

	test.each(['guest', 'host'] as const)(
		'%s still obeys working hours, notice, grid, lookahead, and offered durations',
		async (role) => {
			const cfg = makeConfig([30, 60]);
			const meeting = cfg.meetings[CHAT];
			meeting.padding_before_minutes = 15;
			meeting.padding_after_minutes = 15;
			meeting.daily_booking_limit = 1;
			meeting.notice_minutes = 600;
			const availability = await loadAvailability(db, cfg, CHAT, meeting, role);
			const durations = role === 'host' ? [15, 30, 45, 60, 90, 120, 180, 240, 300] : [30, 60];
			expect(availability.bookingDurations).toEqual({ defaultDuration: 30, durations });
			expect(Object.keys(availability.slotsByDuration)).toEqual(durations.map(String));
			expect(availability.slotsByDuration[30][DAY]).toContain(`${DAY}T10:00:00Z`);
			expect(availability.slotsByDuration[30][DAY]).toContain(EDGE_START);

			const rejected = [
				{ rule: 'working window cutoff', slot: EDGE_START, duration: 60 },
				{ rule: 'notice', slot: `${DAY}T09:30:00Z`, duration: 30 },
				{ rule: 'slot grid', slot: `${DAY}T10:15:00Z`, duration: 30 },
				{ rule: 'lookahead', slot: '2030-06-11T10:00:00Z', duration: 30 },
				{ rule: 'unoffered duration', slot: `${DAY}T11:00:00Z`, duration: 75 }
			];
			for (const { rule, slot, duration } of rejected) {
				const created = await isNewSlotBookable(db, cfg, CHAT, meeting, role, slot, duration);
				const moved = await isRescheduleSlotBookable(
					db,
					cfg,
					CHAT,
					meeting,
					role,
					slot,
					duration,
					currentAppointment(`${DAY}T14:00:00Z`)
				);
				expect(
					availability.slotsByDuration[duration]?.[slot.slice(0, 10)] ?? [],
					rule
				).not.toContain(slot);
				expect([created, moved], rule).toEqual([false, false]);
			}
		}
	);
});

describe('booking duration profiles', () => {
	test('role-specific duration maps follow numeric choices without changing the configured default', async () => {
		const cfg = makeConfig([60, 75, 17, 15]);
		const meeting = cfg.meetings[CHAT];
		const original = structuredClone(cfg);
		for (const role of ['guest', 'host'] as const) {
			const availability = await loadAvailability(db, cfg, CHAT, meeting, role);
			const durations =
				role === 'host' ? [15, 17, 30, 45, 60, 75, 90, 120, 180, 240, 300] : [15, 17, 60, 75];
			expect(availability.bookingDurations).toEqual({ defaultDuration: 60, durations });
			expect(availability.bookingDurations).toEqual(resolveBookingDurations(meeting, role));
			expect(Object.keys(availability.slotsByDuration).map(Number)).toEqual(
				[...durations].sort((a, b) => a - b)
			);
			expect(resolveDuration(meeting, role, durationForm())).toBe(60);
			for (const duration of durations) {
				const slot = `${DAY}T09:00:00Z`;
				const bookable = await isNewSlotBookable(db, cfg, CHAT, meeting, role, slot, duration);
				expect(availability.slotsByDuration[duration][DAY], `${role} ${duration}`).toContain(slot);
				expect(resolveDuration(meeting, role, durationForm(duration))).toBe(duration);
				expect(bookable, `${role} ${duration}`).toBe(true);
			}
		}
		expect(cfg).toEqual(original);
	});

	test.each(['guest', 'host'] as const)(
		'%s current 90 profile, picker, and submissions agree without granting other guest lengths',
		async (role) => {
			const cfg = makeConfig([30]);
			const meeting = cfg.meetings[CHAT];
			const own = `${DAY}T10:00:00Z`;
			await book(CHAT, own, `${DAY}T11:30:00Z`);
			const current = await db
				.selectFrom('appointments')
				.selectAll()
				.where('id', '=', `appt-${CHAT}`)
				.executeTakeFirstOrThrow();
			const availability = await loadAvailability(db, cfg, CHAT, meeting, role, current);
			const newAvailability = await loadAvailability(db, cfg, CHAT, meeting, role);
			const durations = role === 'host' ? [15, 30, 45, 60, 90, 120, 180, 240, 300] : [30, 90];
			expect(availability.bookingDurations).toEqual({ defaultDuration: 90, durations });
			expect(availability.bookingDurations).toEqual(
				resolveBookingDurations(meeting, role, current)
			);
			expect(Object.keys(availability.slotsByDuration)).toEqual(durations.map(String));
			expect(newAvailability.bookingDurations.defaultDuration).toBe(30);
			expect(newAvailability.bookingDurations.durations).toEqual(
				role === 'host' ? durations : [30]
			);
			expect(resolveDuration(meeting, role, durationForm(), current)).toBe(90);
			expect(availability.slotsByDuration[90][DAY]).toContain(own);
			const retained = await isRescheduleSlotBookable(
				db,
				cfg,
				CHAT,
				meeting,
				role,
				own,
				90,
				current
			);
			expect(retained).toBe(true);

			const free = `${DAY}T11:30:00Z`;
			for (const duration of [30, 90, 120]) {
				const expectedNew = role === 'host' || duration === 30;
				const expectedMoved = role === 'host' || duration !== 120;
				const created = await isNewSlotBookable(db, cfg, CHAT, meeting, role, free, duration);
				const moved = await isRescheduleSlotBookable(
					db,
					cfg,
					CHAT,
					meeting,
					role,
					free,
					duration,
					current
				);
				expect(newAvailability.slotsByDuration[duration]?.[DAY] ?? []).toEqual(expect.any(Array));
				expect((newAvailability.slotsByDuration[duration]?.[DAY] ?? []).includes(free)).toBe(
					expectedNew
				);
				expect((availability.slotsByDuration[duration]?.[DAY] ?? []).includes(free)).toBe(
					expectedMoved
				);
				expect(resolveDuration(meeting, role, durationForm(duration), current)).toBe(
					expectedMoved ? duration : null
				);
				expect([created, moved]).toEqual([expectedNew, expectedMoved]);
			}

			const short = await isRescheduleSlotBookable(
				db,
				cfg,
				CHAT,
				meeting,
				role,
				EDGE_START,
				30,
				current
			);
			const long = await isRescheduleSlotBookable(
				db,
				cfg,
				CHAT,
				meeting,
				role,
				EDGE_START,
				90,
				current
			);
			expect(availability.slotsByDuration[30][DAY]).toContain(EDGE_START);
			expect(availability.slotsByDuration[90][DAY]).not.toContain(EDGE_START);
			expect([short, long]).toEqual([true, false]);
		}
	);

	test.each(['guest', 'host'] as const)(
		'%s gets a usable map and submission for current non-palette 85 only when rescheduling',
		async (role) => {
			const cfg = makeConfig([30]);
			const meeting = cfg.meetings[CHAT];
			await book(CHAT, `${DAY}T10:00:00Z`, `${DAY}T11:25:00Z`);
			const current = await db
				.selectFrom('appointments')
				.selectAll()
				.where('id', '=', `appt-${CHAT}`)
				.executeTakeFirstOrThrow();
			const availability = await loadAvailability(db, cfg, CHAT, meeting, role, current);
			const slot = `${DAY}T13:00:00Z`;
			const moved = await isRescheduleSlotBookable(db, cfg, CHAT, meeting, role, slot, 85, current);
			const created = await isNewSlotBookable(db, cfg, CHAT, meeting, role, slot, 85);
			expect(availability.bookingDurations.defaultDuration).toBe(85);
			expect(availability.bookingDurations.durations.filter((duration) => duration === 85)).toEqual(
				[85]
			);
			expect(availability.slotsByDuration[85][DAY]).toContain(slot);
			expect(resolveDuration(meeting, role, durationForm(), current)).toBe(85);
			expect([moved, created]).toEqual([true, false]);
		}
	);

	test.each(['appointment', 'remote'] as const)(
		'chosen long durations still respect actual %s busy time beyond the short duration',
		async (source) => {
			const cfg = makeConfig([30]);
			const meeting = cfg.meetings[CHAT];
			meeting.padding_before_minutes = 15;
			meeting.padding_after_minutes = 15;
			await book(CHAT, `${DAY}T14:00:00Z`, `${DAY}T15:30:00Z`);
			const current = await db
				.selectFrom('appointments')
				.selectAll()
				.where('id', '=', `appt-${CHAT}`)
				.executeTakeFirstOrThrow();
			if (source === 'appointment') {
				cfg.meetings.lunch = { ...meeting };
				await book('lunch', `${DAY}T11:00:00Z`, `${DAY}T11:30:00Z`);
			} else {
				await replaceCalendarBusy(db, meeting.booking_calendar, [
					{ start: `${DAY}T11:00:00Z`, end: `${DAY}T11:30:00Z` }
				]);
			}
			const slot = `${DAY}T10:00:00Z`;
			for (const role of ['guest', 'host'] as const) {
				const availability = await loadAvailability(db, cfg, CHAT, meeting, role, current);
				const short = await isRescheduleSlotBookable(
					db,
					cfg,
					CHAT,
					meeting,
					role,
					slot,
					30,
					current
				);
				const long = await isRescheduleSlotBookable(
					db,
					cfg,
					CHAT,
					meeting,
					role,
					slot,
					90,
					current
				);
				expect(availability.slotsByDuration[30][DAY]).toContain(slot);
				expect(availability.slotsByDuration[90][DAY]).not.toContain(slot);
				expect([short, long]).toEqual([true, false]);
			}
			const newHostShort = await isNewSlotBookable(db, cfg, CHAT, meeting, 'host', slot, 30);
			const newHostLong = await isNewSlotBookable(db, cfg, CHAT, meeting, 'host', slot, 90);
			expect([newHostShort, newHostLong]).toEqual([true, false]);
		}
	);

	test('a long host-created row still occupies time and counts against the guest daily cap', async () => {
		const cfg = makeConfig([30]);
		const meeting = cfg.meetings[CHAT];
		const own = `${DAY}T10:00:00Z`;
		await book(CHAT, own, `${DAY}T11:30:00Z`);
		await db
			.updateTable('appointments')
			.set({
				action_log: JSON.stringify([{ action: 'create', actor: 'host', at: `${DAY}T00:00:00Z` }])
			})
			.where('id', '=', `appt-${CHAT}`)
			.execute();
		const current = await db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', `appt-${CHAT}`)
			.executeTakeFirstOrThrow();
		meeting.daily_booking_limit = 1;
		const guest = await loadAvailability(db, cfg, CHAT, meeting, 'guest', current);
		const host = await loadAvailability(db, cfg, CHAT, meeting, 'host', current);
		const free = `${DAY}T13:00:00Z`;
		const guestMoved = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			meeting,
			'guest',
			free,
			90,
			current
		);
		const hostMoved = await isRescheduleSlotBookable(
			db,
			cfg,
			CHAT,
			meeting,
			'host',
			free,
			90,
			current
		);
		expect(guest.slotsByDuration[90][DAY]).toBeUndefined();
		expect(host.slotsByDuration[90][DAY]).toContain(free);
		expect([guestMoved, hostMoved]).toEqual([false, true]);
		meeting.daily_booking_limit = null;
		const uncappedGuest = await loadAvailability(db, cfg, CHAT, meeting, 'guest');
		expect(uncappedGuest.slotsByDuration[30][DAY]).not.toContain(`${DAY}T11:00:00Z`);
		expect(uncappedGuest.slotsByDuration[30][DAY]).toContain(free);
	});
});
