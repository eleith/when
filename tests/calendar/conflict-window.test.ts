import { expect, test } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { conflictPullWindow } from '$lib/server/calendar/conflicts';

const inst = (s: string): Temporal.Instant => Temporal.Instant.from(s);

test('window starts at now', () => {
	const now = inst('2026-04-15T10:00:00Z');
	const w = conflictPullWindow(now, 'UTC', 60);
	expect(w.start.toString()).toBe('2026-04-15T10:00:00Z');
});

test('window ends at first-of-next-month + 2 weeks when lookahead is large', () => {
	const now = inst('2026-04-15T10:00:00Z');
	const w = conflictPullWindow(now, 'UTC', 365);
	expect(w.end.toString()).toBe('2026-05-15T00:00:00Z');
});

test('window is capped at now + maxLookahead when shorter than the month-end + 2w', () => {
	const now = inst('2026-04-15T10:00:00Z');
	const w = conflictPullWindow(now, 'UTC', 7);
	expect(w.end.toString()).toBe('2026-04-22T10:00:00Z');
});

test('handles end of month correctly (Apr 30 → May 15)', () => {
	const now = inst('2026-04-30T23:00:00Z');
	const w = conflictPullWindow(now, 'UTC', 365);
	expect(w.end.toString()).toBe('2026-05-15T00:00:00Z');
});

test('handles year boundary (Dec → Jan + 2w)', () => {
	const now = inst('2026-12-15T10:00:00Z');
	const w = conflictPullWindow(now, 'UTC', 365);
	expect(w.end.toString()).toBe('2027-01-15T00:00:00Z');
});

test('respects user_tz when computing month end', () => {
	// Apr 30 23:00 UTC is May 1 in Asia/Tokyo (+09:00); the visible month
	// is May, so the cap should be Jun 15 in Tokyo midnight (= Jun 14 15:00 UTC).
	const now = inst('2026-04-30T23:00:00Z');
	const w = conflictPullWindow(now, 'Asia/Tokyo', 365);
	expect(w.end.toString()).toBe('2026-06-14T15:00:00Z');
});
