import { expect, test } from 'vitest';
import { durationsOf } from './durations.js';

test('a meeting with no additional lengths offers one', () => {
	expect(durationsOf({ duration_minutes: 30, additional_duration_minutes: [] })).toEqual([30]);
});

test('the default comes first, then the additional lengths as written', () => {
	expect(durationsOf({ duration_minutes: 30, additional_duration_minutes: [15, 60] })).toEqual([
		30, 15, 60
	]);
});

test('de-duplicates while keeping first-seen order', () => {
	expect(
		durationsOf({ duration_minutes: 30, additional_duration_minutes: [15, 30, 60, 15] })
	).toEqual([30, 15, 60]);
});
