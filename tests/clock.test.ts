import { expect, test } from 'bun:test';
import { fixedClock, systemClock } from '../src/lib/server/clock';

test('systemClock returns a fresh Date', () => {
	const a = systemClock.now();
	expect(a).toBeInstanceOf(Date);
	expect(systemClock.nowMs()).toBeGreaterThan(0);
});

test('fixedClock from ISO pins time', () => {
	const clock = fixedClock('2026-04-24T10:00:00Z');
	expect(clock.nowMs()).toBe(Date.parse('2026-04-24T10:00:00Z'));
	expect(clock.now().toISOString()).toBe('2026-04-24T10:00:00.000Z');
});

test('fixedClock from epoch ms pins time', () => {
	const clock = fixedClock(1_700_000_000_000);
	expect(clock.nowMs()).toBe(1_700_000_000_000);
});

test('fixedClock from Date pins time', () => {
	const d = new Date('2026-01-01T00:00:00Z');
	const clock = fixedClock(d);
	expect(clock.nowMs()).toBe(d.getTime());
});

test('fixedClock rejects invalid input', () => {
	expect(() => fixedClock('not-a-date')).toThrow();
});
