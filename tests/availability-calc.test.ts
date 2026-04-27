import { expect, test } from 'bun:test';
import { Temporal } from '@js-temporal/polyfill';
import { computeSlots } from '../src/lib/server/availability';
import type { EventTypeKnobs, Interval } from '../src/lib/server/availability';

const NYC = 'America/New_York';
const PARIS = 'Europe/Paris';
const I = (s: string) => Temporal.Instant.from(s);

const baseKnobs: EventTypeKnobs = {
	duration: 30,
	slot_granularity: 30,
	minimum_notice: 0,
	maximum_lookahead: 365,
	buffer_before: 0,
	buffer_after: 0,
	max_bookings_per_day: null,
	weekly: {
		monday: ['09:00-17:00'],
		tuesday: ['09:00-17:00'],
		wednesday: ['09:00-17:00'],
		thursday: ['09:00-17:00'],
		friday: ['09:00-17:00'],
		saturday: ['09:00-17:00'],
		sunday: ['09:00-17:00']
	}
};

function defaults(overrides: Partial<EventTypeKnobs> = {}): EventTypeKnobs {
	return { ...baseKnobs, ...overrides };
}

const emptyCtx = {
	existingAppointments: [] as Interval[],
	remoteBusy: [] as Interval[],
	perDayCount: new Map<string, number>()
};

test('DST spring forward: NYC 2026-03-08 00:00-04:00 skips 02:00/02:30 NYC', () => {
	const knobs = defaults({
		duration: 30,
		slot_granularity: 30,
		weekly: { sunday: ['00:00-04:00'] }
	});
	const slots = computeSlots({
		knobs,
		userTz: NYC,
		now: I('2026-03-08T00:00:00Z'),
		rangeStart: I('2026-03-08T05:00:00Z'),
		rangeEnd: I('2026-03-08T08:30:00Z'),
		...emptyCtx
	});
	const localTimes = slots.map((s) =>
		s.toZonedDateTimeISO(NYC).toPlainTime().toString({ smallestUnit: 'minute' })
	);
	expect(localTimes).toEqual(['00:00', '00:30', '01:00', '01:30', '03:00', '03:30']);
});

test('DST fall back: NYC 2026-11-01 the duplicated 01:00 hour is counted once', () => {
	const knobs = defaults({
		duration: 30,
		slot_granularity: 30,
		weekly: { sunday: ['00:00-04:00'] }
	});
	// 00:00-04:00 wall-clock spans 5 actual hours due to fall-back, so 10 slots.
	const slots = computeSlots({
		knobs,
		userTz: NYC,
		now: I('2026-11-01T00:00:00Z'),
		rangeStart: I('2026-11-01T04:00:00Z'),
		rangeEnd: I('2026-11-01T09:30:00Z'),
		...emptyCtx
	});
	expect(slots).toHaveLength(10);
});

test('booker TZ is irrelevant — slots are UTC instants admin-anchored', () => {
	const knobs = defaults({
		duration: 30,
		slot_granularity: 30,
		weekly: { monday: ['09:00-17:00'] }
	});
	// 2026-04-27 is a Monday. 09:00 NYC EDT = 13:00 UTC = 15:00 Paris CEST.
	const slots = computeSlots({
		knobs,
		userTz: NYC,
		now: I('2026-04-27T00:00:00Z'),
		rangeStart: I('2026-04-27T13:00:00Z'),
		rangeEnd: I('2026-04-27T22:00:00Z'),
		...emptyCtx
	});
	expect(slots[0].toString()).toBe('2026-04-27T13:00:00Z');
	expect(slots[0].toZonedDateTimeISO(PARIS).toPlainTime().toString()).toBe('15:00:00');
});

test('block at 10:00-10:30 UTC rejects overlapping slots, accepts 10:30', () => {
	const knobs = defaults({
		duration: 30,
		slot_granularity: 15,
		buffer_before: 0,
		buffer_after: 0,
		weekly: { monday: ['05:00-12:00'] } // window in NYC local; 05:00 NYC EDT = 09:00 UTC
	});
	const block: Interval = { start: I('2026-04-27T10:00:00Z'), end: I('2026-04-27T10:30:00Z') };
	const slots = computeSlots({
		knobs,
		userTz: NYC,
		now: I('2026-04-27T00:00:00Z'),
		rangeStart: I('2026-04-27T09:00:00Z'),
		rangeEnd: I('2026-04-27T16:00:00Z'),
		existingAppointments: [],
		remoteBusy: [block],
		perDayCount: new Map()
	});
	const utc = slots.map((s) => s.toString());
	// Window in UTC: [09:00, 16:00]. Block 10:00-10:30 UTC.
	// Slots at granularity 15 starting at 09:00. 09:45 ends 10:15 → overlap. Reject.
	expect(utc).not.toContain('2026-04-27T09:45:00Z');
	expect(utc).not.toContain('2026-04-27T10:00:00Z');
	expect(utc).not.toContain('2026-04-27T10:15:00Z');
	expect(utc).toContain('2026-04-27T10:30:00Z');
});

test('buffer_before extends the rejection window', () => {
	const knobs = defaults({
		duration: 30,
		slot_granularity: 5,
		buffer_before: 10,
		buffer_after: 0,
		weekly: { monday: ['05:00-12:00'] }
	});
	const block: Interval = { start: I('2026-04-27T10:00:00Z'), end: I('2026-04-27T10:30:00Z') };
	const slots = computeSlots({
		knobs,
		userTz: NYC,
		now: I('2026-04-27T00:00:00Z'),
		rangeStart: I('2026-04-27T09:00:00Z'),
		rangeEnd: I('2026-04-27T11:00:00Z'),
		existingAppointments: [],
		remoteBusy: [block],
		perDayCount: new Map()
	});
	const utc = slots.map((s) => s.toString());
	expect(utc).not.toContain('2026-04-27T10:30:00Z'); // buffered start 10:20 overlaps block
	expect(utc).toContain('2026-04-27T10:40:00Z'); // buffered start 10:30 — touches, no overlap
});

test('minimum_notice excludes anything sooner than now + notice', () => {
	const knobs = defaults({
		duration: 30,
		slot_granularity: 30,
		minimum_notice: 120,
		weekly: { monday: ['05:00-17:00'] }
	});
	const slots = computeSlots({
		knobs,
		userTz: NYC,
		now: I('2026-04-27T10:00:00Z'),
		rangeStart: I('2026-04-27T09:00:00Z'),
		rangeEnd: I('2026-04-27T20:00:00Z'),
		...emptyCtx
	});
	expect(slots[0].toString()).toBe('2026-04-27T12:00:00Z');
});

test('maximum_lookahead caps at end-of-day in user_tz', () => {
	const knobs = defaults({
		duration: 30,
		slot_granularity: 60,
		maximum_lookahead: 1,
		weekly: {
			monday: ['09:00-17:00'],
			tuesday: ['09:00-17:00'],
			wednesday: ['09:00-17:00']
		}
	});
	const now = I('2026-04-27T14:00:00Z'); // 10:00 NYC EDT, Monday
	const slots = computeSlots({
		knobs,
		userTz: NYC,
		now,
		rangeStart: now,
		rangeEnd: I('2026-04-30T00:00:00Z'),
		...emptyCtx
	});
	// Max lookahead = 1 day → end of 2026-04-28 in NYC. 2026-04-29 must be excluded.
	const dates = new Set(slots.map((s) => s.toZonedDateTimeISO(NYC).toPlainDate().toString()));
	expect(dates).toContain('2026-04-27');
	expect(dates).toContain('2026-04-28');
	expect(dates.has('2026-04-29')).toBe(false);
});

test('max_bookings_per_day rejects all candidates on capped days', () => {
	const knobs = defaults({
		duration: 30,
		slot_granularity: 30,
		max_bookings_per_day: 2,
		weekly: {
			monday: ['09:00-17:00'],
			tuesday: ['09:00-17:00']
		}
	});
	const slots = computeSlots({
		knobs,
		userTz: NYC,
		now: I('2026-04-27T00:00:00Z'),
		rangeStart: I('2026-04-27T13:00:00Z'),
		rangeEnd: I('2026-04-29T00:00:00Z'),
		existingAppointments: [],
		remoteBusy: [],
		perDayCount: new Map([
			['2026-04-27', 2] // capped
		])
	});
	const dates = new Set(slots.map((s) => s.toZonedDateTimeISO(NYC).toPlainDate().toString()));
	expect(dates.has('2026-04-27')).toBe(false);
	expect(dates.has('2026-04-28')).toBe(true);
});

test('empty availability for a weekday emits no slots', () => {
	const knobs = defaults({ weekly: { friday: ['09:00-17:00'] } }); // Sat/Sun missing
	const slots = computeSlots({
		knobs,
		userTz: NYC,
		now: I('2026-04-25T00:00:00Z'),
		rangeStart: I('2026-04-25T13:00:00Z'), // Saturday
		rangeEnd: I('2026-04-25T22:00:00Z'),
		...emptyCtx
	});
	expect(slots).toEqual([]);
});

test('RRULE-expanded blocks: same wall-clock slot blocked across consecutive weeks', () => {
	const knobs = defaults({
		duration: 30,
		slot_granularity: 30,
		weekly: {
			monday: ['09:00-17:00'],
			tuesday: ['09:00-17:00']
		}
	});
	// Simulate a weekly Mon 10:00-10:30 NYC standup (already RRULE-expanded).
	// 10:00 NYC EDT = 14:00 UTC.
	const remoteBusy: Interval[] = [
		{ start: I('2026-04-27T14:00:00Z'), end: I('2026-04-27T14:30:00Z') },
		{ start: I('2026-05-04T14:00:00Z'), end: I('2026-05-04T14:30:00Z') }
	];
	const slots = computeSlots({
		knobs,
		userTz: NYC,
		now: I('2026-04-27T00:00:00Z'),
		rangeStart: I('2026-04-27T13:00:00Z'),
		rangeEnd: I('2026-05-04T21:00:00Z'),
		existingAppointments: [],
		remoteBusy,
		perDayCount: new Map()
	});
	const utc = new Set(slots.map((s) => s.toString()));
	expect(utc.has('2026-04-27T14:00:00Z')).toBe(false); // Monday standup
	expect(utc.has('2026-05-04T14:00:00Z')).toBe(false); // next Monday standup
	expect(utc.has('2026-04-28T14:00:00Z')).toBe(true); // Tuesday — not blocked
});
