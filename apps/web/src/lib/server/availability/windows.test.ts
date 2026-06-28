import { expect, test } from 'vitest';
import { buildBaseWindows, candidateDates, localToInstant, weekdayOf } from './windows';
import type { WeeklySchedule } from '$lib/server/availability/types';

const NYC = 'America/New_York';

function plainDate(s: string): Temporal.PlainDate {
	return Temporal.PlainDate.from(s);
}

function instant(s: string): Temporal.Instant {
	return Temporal.Instant.from(s);
}

test('weekdayOf returns the right weekday for a known date', () => {
	expect(weekdayOf(plainDate('2026-04-24'))).toBe('friday');
	expect(weekdayOf(plainDate('2026-04-26'))).toBe('sunday');
});

test('candidateDates expands an instant range into PlainDates in user_tz', () => {
	const start = instant('2026-04-30T22:00:00Z'); // 2026-04-30 18:00 NYC
	const end = instant('2026-05-02T22:00:00Z'); // 2026-05-02 18:00 NYC
	const dates = candidateDates(start, end, NYC);
	expect(dates.map((d) => d.toString())).toEqual(['2026-04-30', '2026-05-01', '2026-05-02']);
});

test('candidateDates uses user_tz when picking the date', () => {
	// 2026-05-01 23:30 UTC is 2026-05-01 19:30 NYC, but 2026-05-02 08:30 Tokyo.
	const i = instant('2026-05-01T23:30:00Z');
	expect(candidateDates(i, i, NYC).map((d) => d.toString())).toEqual(['2026-05-01']);
	expect(candidateDates(i, i, 'Asia/Tokyo').map((d) => d.toString())).toEqual(['2026-05-02']);
});

test('candidateDates returns [] for an inverted range', () => {
	expect(
		candidateDates(instant('2026-05-02T00:00:00Z'), instant('2026-05-01T00:00:00Z'), NYC)
	).toEqual([]);
});

const NINE_TO_FIVE: WeeklySchedule = {
	monday: ['09:00-17:00'],
	tuesday: ['09:00-17:00'],
	wednesday: ['09:00-17:00'],
	thursday: ['09:00-17:00'],
	friday: ['09:00-17:00']
};

test('buildBaseWindows returns one UTC interval for a normal weekday', () => {
	const intervals = buildBaseWindows(plainDate('2026-04-27'), NINE_TO_FIVE, NYC); // a Monday
	expect(intervals).toHaveLength(1);
	expect(intervals[0].start.toString()).toBe('2026-04-27T13:00:00Z'); // 09:00 NYC EDT
	expect(intervals[0].end.toString()).toBe('2026-04-27T21:00:00Z'); // 17:00 NYC EDT
});

test('buildBaseWindows returns [] for a day with no entries', () => {
	expect(buildBaseWindows(plainDate('2026-05-02'), NINE_TO_FIVE, NYC)).toEqual([]); // Saturday
});

test('buildBaseWindows supports multiple ranges per day', () => {
	const split: WeeklySchedule = {
		monday: ['09:00-12:00', '13:00-17:00']
	};
	const intervals = buildBaseWindows(plainDate('2026-04-27'), split, NYC);
	expect(intervals).toHaveLength(2);
	expect(intervals[0].start.toString()).toBe('2026-04-27T13:00:00Z');
	expect(intervals[0].end.toString()).toBe('2026-04-27T16:00:00Z');
	expect(intervals[1].start.toString()).toBe('2026-04-27T17:00:00Z');
	expect(intervals[1].end.toString()).toBe('2026-04-27T21:00:00Z');
});

test('buildBaseWindows drops a window crossing a DST spring-forward gap', () => {
	// 2026-03-08 in NYC: 02:00 → 03:00 does not exist
	const inGap: WeeklySchedule = {
		sunday: ['02:00-04:00']
	};
	expect(buildBaseWindows(plainDate('2026-03-08'), inGap, NYC)).toEqual([]);
});

test('buildBaseWindows around fall-back picks the earlier occurrence', () => {
	// 2026-11-01 in NYC: 01:00 → 02:00 occurs twice; the earlier is at -04:00.
	const fallback: WeeklySchedule = {
		sunday: ['00:00-04:00']
	};
	const intervals = buildBaseWindows(plainDate('2026-11-01'), fallback, NYC);
	expect(intervals).toHaveLength(1);
	// 00:00 NYC EDT (fall back hasn't happened yet) = 04:00 UTC
	expect(intervals[0].start.toString()).toBe('2026-11-01T04:00:00Z');
	// 04:00 NYC EST (after fall back) = 09:00 UTC; window length 5h in wall-clock
	expect(intervals[0].end.toString()).toBe('2026-11-01T09:00:00Z');
});

test('buildBaseWindows rejects ill-formed range strings', () => {
	const bad: WeeklySchedule = { monday: ['9-5'] };
	expect(buildBaseWindows(plainDate('2026-04-27'), bad, NYC)).toEqual([]);
});

test('buildBaseWindows rejects inverted ranges', () => {
	const bad: WeeklySchedule = { monday: ['17:00-09:00'] };
	expect(buildBaseWindows(plainDate('2026-04-27'), bad, NYC)).toEqual([]);
});

test('localToInstant returns null for a DST-gap local time', () => {
	expect(localToInstant(plainDate('2026-03-08'), Temporal.PlainTime.from('02:30'), NYC)).toBeNull();
});
