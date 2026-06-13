import { describe, expect, test } from 'vitest';
import { flattenSlots, availableDates, slotsOnDate, canAdvance } from './booking';

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
