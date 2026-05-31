import { expect, test } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { mergeBlocks, overlapsAny } from './blocks';
import { generateSlots } from '$lib/server/availability/slots';

const I = (s: string) => Temporal.Instant.from(s);
const interval = (s: string, e: string) => ({ start: I(s), end: I(e) });

test('mergeBlocks returns [] for empty input', () => {
	expect(mergeBlocks([])).toEqual([]);
});

test('mergeBlocks sorts by start', () => {
	const merged = mergeBlocks([
		interval('2026-05-01T13:00:00Z', '2026-05-01T14:00:00Z'),
		interval('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z')
	]);
	expect(merged.map((b) => b.start.toString())).toEqual([
		'2026-05-01T10:00:00Z',
		'2026-05-01T13:00:00Z'
	]);
});

test('mergeBlocks merges overlapping intervals', () => {
	const merged = mergeBlocks([
		interval('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'),
		interval('2026-05-01T10:30:00Z', '2026-05-01T11:30:00Z')
	]);
	expect(merged).toHaveLength(1);
	expect(merged[0].start.toString()).toBe('2026-05-01T10:00:00Z');
	expect(merged[0].end.toString()).toBe('2026-05-01T11:30:00Z');
});

test('mergeBlocks merges touching intervals', () => {
	const merged = mergeBlocks([
		interval('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'),
		interval('2026-05-01T11:00:00Z', '2026-05-01T12:00:00Z')
	]);
	expect(merged).toHaveLength(1);
	expect(merged[0].end.toString()).toBe('2026-05-01T12:00:00Z');
});

test('mergeBlocks keeps non-overlapping intervals separate', () => {
	const merged = mergeBlocks([
		interval('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'),
		interval('2026-05-01T12:00:00Z', '2026-05-01T13:00:00Z')
	]);
	expect(merged).toHaveLength(2);
});

test('overlapsAny: touching at the boundary does not overlap', () => {
	const blocks = [interval('2026-05-01T10:00:00Z', '2026-05-01T10:30:00Z')];
	expect(overlapsAny(interval('2026-05-01T10:30:00Z', '2026-05-01T11:00:00Z'), blocks)).toBe(false);
});

test('overlapsAny: covered by a block returns true', () => {
	const blocks = [interval('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z')];
	expect(overlapsAny(interval('2026-05-01T10:15:00Z', '2026-05-01T10:45:00Z'), blocks)).toBe(true);
});

test('generateSlots stops when next slot would extend past the window end', () => {
	const window = interval('2026-05-01T13:00:00Z', '2026-05-01T14:00:00Z');
	const slots = generateSlots(window, 30, 15);
	expect(slots.map((s) => s.toString())).toEqual([
		'2026-05-01T13:00:00Z',
		'2026-05-01T13:15:00Z',
		'2026-05-01T13:30:00Z'
	]);
});

test('generateSlots emits no slots when duration > window', () => {
	const window = interval('2026-05-01T13:00:00Z', '2026-05-01T13:15:00Z');
	expect(generateSlots(window, 30, 15)).toEqual([]);
});

test('generateSlots produces a single slot when duration == window', () => {
	const window = interval('2026-05-01T13:00:00Z', '2026-05-01T13:30:00Z');
	const slots = generateSlots(window, 30, 15);
	expect(slots.map((s) => s.toString())).toEqual(['2026-05-01T13:00:00Z']);
});
