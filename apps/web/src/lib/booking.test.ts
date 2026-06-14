import { describe, expect, test } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import {
	flattenSlots,
	availableDates,
	slotsOnDate,
	canAdvance,
	resolveDeepLink,
	buildDayTimeline
} from './booking';

// Slots straddle a UTC midnight so the timezone-dependent cases are meaningful:
// 23:30Z on the 15th is still the 15th in UTC but already the 16th in Tokyo.
const SLOTS_BY_DATE = {
	'2025-06-15': ['2025-06-15T09:00:00Z', '2025-06-15T09:30:00Z', '2025-06-15T23:30:00Z'],
	'2025-06-16': ['2025-06-16T09:00:00Z']
};

describe('flattenSlots', () => {
	test('flattens every date bucket into one list', () => {
		expect(flattenSlots(SLOTS_BY_DATE)).toEqual([
			'2025-06-15T09:00:00Z',
			'2025-06-15T09:30:00Z',
			'2025-06-15T23:30:00Z',
			'2025-06-16T09:00:00Z'
		]);
	});

	test('returns an empty list when there are no slots', () => {
		expect(flattenSlots({})).toEqual([]);
	});
});

describe('availableDates', () => {
	test('collects the distinct local dates of the slots', () => {
		const slots = flattenSlots(SLOTS_BY_DATE);
		expect([...availableDates(slots, 'UTC')].sort()).toEqual(['2025-06-15', '2025-06-16']);
	});

	test('buckets by the viewer timezone, not UTC', () => {
		// In Tokyo (UTC+9) the 23:30Z slot lands on the 16th, so the 16th appears
		// from two different source instants and the 15th only from the daytime ones.
		const slots = flattenSlots(SLOTS_BY_DATE);
		expect([...availableDates(slots, 'Asia/Tokyo')].sort()).toEqual(['2025-06-15', '2025-06-16']);
		expect(availableDates(['2025-06-15T23:30:00Z'], 'Asia/Tokyo')).toEqual(new Set(['2025-06-16']));
	});
});

describe('slotsOnDate', () => {
	test('returns only the slots on the given local date, sorted', () => {
		const slots = flattenSlots(SLOTS_BY_DATE);
		expect(slotsOnDate(slots, '2025-06-15', 'UTC')).toEqual([
			'2025-06-15T09:00:00Z',
			'2025-06-15T09:30:00Z',
			'2025-06-15T23:30:00Z'
		]);
	});

	test('reassigns a late slot to the next day under a forward timezone', () => {
		const slots = flattenSlots(SLOTS_BY_DATE);
		expect(slotsOnDate(slots, '2025-06-16', 'Asia/Tokyo')).toEqual([
			'2025-06-15T23:30:00Z',
			'2025-06-16T09:00:00Z'
		]);
	});

	test('returns an empty list for a date with no slots', () => {
		expect(slotsOnDate(flattenSlots(SLOTS_BY_DATE), '2025-06-20', 'UTC')).toEqual([]);
	});
});

describe('canAdvance', () => {
	test('step 1 needs a date', () => {
		expect(canAdvance(1, null, null)).toBe(false);
		expect(canAdvance(1, '2025-06-15', null)).toBe(true);
	});

	test('step 2 needs a slot', () => {
		expect(canAdvance(2, '2025-06-15', null)).toBe(false);
		expect(canAdvance(2, '2025-06-15', '2025-06-15T09:00:00Z')).toBe(true);
	});

	test('step 3 is always allowed', () => {
		expect(canAdvance(3, null, null)).toBe(true);
	});
});

describe('resolveDeepLink', () => {
	const allSlots = flattenSlots(SLOTS_BY_DATE);
	const dates = availableDates(allSlots, 'UTC');
	const base = { slotParam: null, dateParam: null, allSlots, availableDates: dates };

	test('no params → step 1', () => {
		expect(resolveDeepLink(base)).toEqual({ step: 1 });
	});

	test('valid slot → step 3', () => {
		expect(resolveDeepLink({ ...base, slotParam: '2025-06-15T09:30:00Z' })).toEqual({
			step: 3,
			slot: '2025-06-15T09:30:00Z'
		});
	});

	test('stale slot → step 1 with a slot notice', () => {
		expect(resolveDeepLink({ ...base, slotParam: '2025-06-15T12:00:00Z' })).toEqual({
			step: 1,
			notice: { kind: 'slot', requested: '2025-06-15T12:00:00Z' }
		});
	});

	test('valid date → step 2', () => {
		expect(resolveDeepLink({ ...base, dateParam: '2025-06-16' })).toEqual({
			step: 2,
			date: '2025-06-16'
		});
	});

	test('stale date → step 1 with a date notice', () => {
		expect(resolveDeepLink({ ...base, dateParam: '2025-06-20' })).toEqual({
			step: 1,
			notice: { kind: 'date', requested: '2025-06-20' }
		});
	});

	test('slot wins when both are present', () => {
		expect(
			resolveDeepLink({ ...base, slotParam: '2025-06-15T09:00:00Z', dateParam: '2025-06-16' })
		).toEqual({ step: 3, slot: '2025-06-15T09:00:00Z' });
	});
});

describe('buildDayTimeline', () => {
	// A 09:00–17:00 UTC working day, one busy hour at noon, two 30-min slots.
	const base = {
		viewDate: '2025-06-15',
		workingWindows: [{ start: '2025-06-15T09:00:00Z', end: '2025-06-15T17:00:00Z' }],
		busyBlocks: [{ start: '2025-06-15T12:00:00Z', end: '2025-06-15T13:00:00Z' }],
		eventType: { duration: 30 },
		daySlots: ['2025-06-15T09:00:00Z', '2025-06-15T09:30:00Z'],
		tz: 'UTC',
		originalSlot: null,
		// well before the view window, so nothing is in the past
		now: Temporal.Instant.from('2025-06-15T00:00:00Z')
	};

	test('returns null when the day has no working window', () => {
		expect(buildDayTimeline({ ...base, workingWindows: [] })).toBeNull();
	});

	test('spans one hour of padding around the working window', () => {
		const t = buildDayTimeline(base)!;
		// 08:00 → 18:00 is 10h
		expect(t.totalMs).toBe(10 * 3600 * 1000);
		// working window 09:00–17:00 sits at 10%–90%
		expect(t.working).toEqual([{ top: 10, height: 80 }]);
	});

	test('positions busy and buffer bands as percentages', () => {
		const t = buildDayTimeline(base)!;
		// noon–13:00 → 40%, one hour tall
		expect(t.busy).toEqual([{ top: 40, height: 10 }]);
		// no buffers configured, so buffers mirror the busy block
		expect(t.buffers).toEqual([{ top: 40, height: 10 }]);
	});

	test('grows buffers by the configured buffer minutes', () => {
		const t = buildDayTimeline({
			...base,
			eventType: { duration: 30, buffer_before: 30, buffer_after: 30 }
		})!;
		// 11:30–13:30 → 35%, two hours tall (height is float math, hence closeTo)
		expect(t.buffers).toHaveLength(1);
		expect(t.buffers[0].top).toBe(35);
		expect(t.buffers[0].height).toBeCloseTo(20);
	});

	test('places slots by start and duration, flagging the original', () => {
		const t = buildDayTimeline({ ...base, originalSlot: '2025-06-15T09:30:00Z' })!;
		expect(t.slots).toEqual([
			{ iso: '2025-06-15T09:00:00Z', time: '09:00 AM', top: 10, height: 5, isOriginal: false },
			{ iso: '2025-06-15T09:30:00Z', time: '09:30 AM', top: 15, height: 5, isOriginal: true }
		]);
	});

	test('labels every hour of the view window', () => {
		const t = buildDayTimeline(base)!;
		expect(t.labels).toHaveLength(10); // 8 AM … 5 PM inclusive
		expect(t.labels[0]).toEqual({ label: '8 AM', top: 0 });
	});

	test('leaves nothing in the past when now precedes the window', () => {
		expect(buildDayTimeline(base)!.past).toBeNull();
	});

	test('shades up to the notice cutoff when now is inside the window', () => {
		const t = buildDayTimeline({ ...base, now: Temporal.Instant.from('2025-06-15T10:00:00Z') })!;
		// 10:00 is 20% into the 08:00–18:00 view
		expect(t.past).toEqual({ top: 0, height: 20 });
	});
});
