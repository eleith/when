import { expect, test } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { expandBusy, type ExpandWindow } from '../../src/lib/server/calendar/expand';
import type { BusyEvent } from '../../src/lib/server/calendar/types';

const inst = (s: string): Temporal.Instant => Temporal.Instant.from(s);

const monthWindow: ExpandWindow = {
	start: inst('2026-01-01T00:00:00Z'),
	end: inst('2026-02-01T00:00:00Z')
};

test('single event inside window appears once', () => {
	const events: BusyEvent[] = [
		{
			uid: 'a',
			start: inst('2026-01-15T10:00:00Z'),
			end: inst('2026-01-15T11:00:00Z')
		}
	];
	const occ = expandBusy(events, monthWindow);
	expect(occ).toHaveLength(1);
	expect(occ[0].uid).toBe('a');
	expect(occ[0].start.toString()).toBe('2026-01-15T10:00:00Z');
});

test('event entirely before window is dropped', () => {
	const events: BusyEvent[] = [
		{
			uid: 'a',
			start: inst('2025-12-31T22:00:00Z'),
			end: inst('2025-12-31T23:00:00Z')
		}
	];
	expect(expandBusy(events, monthWindow)).toEqual([]);
});

test('event entirely after window is dropped', () => {
	const events: BusyEvent[] = [
		{
			uid: 'a',
			start: inst('2026-02-15T10:00:00Z'),
			end: inst('2026-02-15T11:00:00Z')
		}
	];
	expect(expandBusy(events, monthWindow)).toEqual([]);
});

test('event ending exactly at window.start does not intersect', () => {
	const events: BusyEvent[] = [
		{
			uid: 'a',
			start: inst('2025-12-31T23:00:00Z'),
			end: inst('2026-01-01T00:00:00Z')
		}
	];
	expect(expandBusy(events, monthWindow)).toEqual([]);
});

test('weekly recurrence with COUNT=4 yields 4 occurrences', () => {
	const events: BusyEvent[] = [
		{
			uid: 'weekly',
			start: inst('2026-01-06T13:00:00Z'),
			end: inst('2026-01-06T14:00:00Z'),
			rrule: { frequency: 'WEEKLY', count: 4 }
		}
	];
	const occ = expandBusy(events, monthWindow);
	expect(occ).toHaveLength(4);
	expect(occ.map((o) => o.start.toString())).toEqual([
		'2026-01-06T13:00:00Z',
		'2026-01-13T13:00:00Z',
		'2026-01-20T13:00:00Z',
		'2026-01-27T13:00:00Z'
	]);
});

test('window clips weekly recurrence', () => {
	const events: BusyEvent[] = [
		{
			uid: 'weekly',
			start: inst('2026-01-06T13:00:00Z'),
			end: inst('2026-01-06T14:00:00Z'),
			rrule: { frequency: 'WEEKLY', count: 10 }
		}
	];
	const occ = expandBusy(events, {
		start: inst('2026-01-01T00:00:00Z'),
		end: inst('2026-01-21T00:00:00Z')
	});
	expect(occ.map((o) => o.start.toString())).toEqual([
		'2026-01-06T13:00:00Z',
		'2026-01-13T13:00:00Z',
		'2026-01-20T13:00:00Z'
	]);
});

test('EXDATE excludes that occurrence from expansion', () => {
	const events: BusyEvent[] = [
		{
			uid: 'weekly',
			start: inst('2026-01-06T13:00:00Z'),
			end: inst('2026-01-06T14:00:00Z'),
			rrule: { frequency: 'WEEKLY', count: 4 },
			exdates: [inst('2026-01-20T13:00:00Z')]
		}
	];
	const occ = expandBusy(events, monthWindow);
	expect(occ.map((o) => o.start.toString())).toEqual([
		'2026-01-06T13:00:00Z',
		'2026-01-13T13:00:00Z',
		'2026-01-27T13:00:00Z'
	]);
});

test('RECURRENCE-ID override replaces a generated occurrence', () => {
	const events: BusyEvent[] = [
		{
			uid: 'weekly',
			start: inst('2026-01-06T13:00:00Z'),
			end: inst('2026-01-06T14:00:00Z'),
			rrule: { frequency: 'WEEKLY', count: 3 }
		},
		{
			uid: 'weekly',
			start: inst('2026-01-13T15:00:00Z'),
			end: inst('2026-01-13T16:00:00Z'),
			recurrenceId: inst('2026-01-13T13:00:00Z')
		}
	];
	const occ = expandBusy(events, monthWindow);
	expect(occ).toHaveLength(3);
	const moved = occ.find((o) => o.start.toString() === '2026-01-13T15:00:00Z');
	expect(moved).toBeDefined();
	expect(occ.find((o) => o.start.toString() === '2026-01-13T13:00:00Z')).toBeUndefined();
});

test('orphan override (no matching generated occurrence) is still emitted', () => {
	const events: BusyEvent[] = [
		{
			uid: 'weekly',
			start: inst('2026-01-06T13:00:00Z'),
			end: inst('2026-01-06T14:00:00Z'),
			rrule: { frequency: 'WEEKLY', count: 1 }
		},
		{
			uid: 'weekly',
			start: inst('2026-01-22T15:00:00Z'),
			end: inst('2026-01-22T16:00:00Z'),
			recurrenceId: inst('2026-01-20T13:00:00Z')
		}
	];
	const occ = expandBusy(events, monthWindow);
	expect(occ.map((o) => o.start.toString()).sort()).toEqual([
		'2026-01-06T13:00:00Z',
		'2026-01-22T15:00:00Z'
	]);
});

test('daily recurrence with INTERVAL=2', () => {
	const events: BusyEvent[] = [
		{
			uid: 'daily',
			start: inst('2026-01-05T09:00:00Z'),
			end: inst('2026-01-05T09:30:00Z'),
			rrule: { frequency: 'DAILY', interval: 2, count: 5 }
		}
	];
	const occ = expandBusy(events, monthWindow);
	expect(occ.map((o) => o.start.toString())).toEqual([
		'2026-01-05T09:00:00Z',
		'2026-01-07T09:00:00Z',
		'2026-01-09T09:00:00Z',
		'2026-01-11T09:00:00Z',
		'2026-01-13T09:00:00Z'
	]);
});
