import { expect, test } from 'vitest';
import { durationsOf } from './durations.js';

test('wraps a single value in a one-element list', () => {
	expect(durationsOf({ duration_minutes: 30 })).toEqual([30]);
});

test('returns an array as-is, preserving config order', () => {
	expect(durationsOf({ duration_minutes: [30, 15, 60] })).toEqual([30, 15, 60]);
});

test('de-duplicates while keeping first-seen order', () => {
	expect(durationsOf({ duration_minutes: [30, 15, 30, 60, 15] })).toEqual([30, 15, 60]);
});
