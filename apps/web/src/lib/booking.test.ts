import { describe, expect, test } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import {
	flattenSlots,
	availableDates,
	slotsOnDate,
	canAdvance,
	resolveDeepLink,
	normalizeDeepLinkParams,
	buildDayTimeline,
	resolveFriendlyTz
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
	const base = { slotParam: null, dateParam: null, tzParam: null, allSlots, defaultTz: 'UTC' };

	test('no params → step 1', () => {
		expect(resolveDeepLink(base)).toEqual({ step: 1, tz: 'UTC' });
	});

	test('valid date → step 2', () => {
		expect(resolveDeepLink({ ...base, dateParam: '2025-06-15' })).toEqual({
			step: 2,
			date: '2025-06-15',
			tz: 'UTC'
		});
	});

	test('stale date → step 1 with a date notice', () => {
		expect(resolveDeepLink({ ...base, dateParam: '2025-06-20' })).toEqual({
			step: 1,
			notice: { kind: 'date', requested: '2025-06-20' },
			tz: 'UTC'
		});
	});

	test('valid date and slot → step 3', () => {
		expect(resolveDeepLink({ ...base, dateParam: '2025-06-15', slotParam: '09:30' })).toEqual({
			step: 3,
			slot: '2025-06-15T09:30:00Z',
			date: '2025-06-15',
			tz: 'UTC'
		});
	});

	test('stale slot on available date → step 2 with a slot notice', () => {
		expect(resolveDeepLink({ ...base, dateParam: '2025-06-15', slotParam: '12:00' })).toEqual({
			step: 2,
			date: '2025-06-15',
			notice: { kind: 'slot', requested: '2025-06-15T12:00:00Z' },
			tz: 'UTC'
		});
	});

	test('stale slot on unavailable date → step 1 with a slot notice', () => {
		expect(resolveDeepLink({ ...base, dateParam: '2025-06-20', slotParam: '12:00' })).toEqual({
			step: 1,
			notice: { kind: 'slot', requested: '2025-06-20T12:00:00Z' },
			tz: 'UTC'
		});
	});

	test('timezone resolution on slot', () => {
		// In Asia/Tokyo (UTC+9), 2025-06-16T08:30 is 2025-06-15T23:30:00Z, which is in allSlots
		expect(
			resolveDeepLink({
				...base,
				dateParam: '2025-06-16',
				slotParam: '08:30',
				tzParam: 'Asia/Tokyo'
			})
		).toEqual({
			step: 3,
			slot: '2025-06-15T23:30:00Z',
			date: '2025-06-16',
			tz: 'Asia/Tokyo'
		});
	});
});

describe('normalizeDeepLinkParams', () => {
	const norm = (q: string) => normalizeDeepLinkParams(new URLSearchParams(q), 'UTC');

	test('keeps a valid date and fills default tz', () => {
		expect(norm('date=2026-06-19')).toEqual({ date: '2026-06-19', tz: '0000' });
	});

	test('keeps a valid date and valid tz', () => {
		expect(norm('date=2026-06-19&tz=America/New_York')).toEqual({
			date: '2026-06-19',
			tz: '-0400'
		});
	});

	test('keeps a valid date, slot, and tz', () => {
		expect(norm('date=2026-06-19&slot=18:30&tz=America/New_York')).toEqual({
			date: '2026-06-19',
			slot: '1830',
			tz: '-0400'
		});
	});

	test('drops slot when date is missing', () => {
		expect(norm('slot=18:30&tz=America/New_York')).toEqual({});
	});

	test('drops a malformed date', () => {
		expect(norm('date=2026-13-99')).toEqual({});
	});

	test('strips an invalid tz rather than healing it', () => {
		expect(norm('date=2026-06-19&tz=70a')).toEqual({
			date: '2026-06-19'
		});
	});

	test('strips an invalid slot rather than healing it', () => {
		expect(norm('date=2026-06-19&slot=abc')).toEqual({
			date: '2026-06-19',
			tz: '0000'
		});
	});

	test('drops unknown keys (nothing valid remains)', () => {
		expect(norm('foo=bar')).toEqual({});
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

describe('resolveFriendlyTz', () => {
	test('returns the timezone immediately if already a friendly IANA zone', () => {
		expect(resolveFriendlyTz('America/New_York', '2026-06-19', 'UTC')).toBe('America/New_York');
	});

	test('resolves offset timezone to fallback if offset matches', () => {
		// Etc/GMT+7 represents offset -7 (which matches America/Los_Angeles on 2026-06-19 due to PDT)
		expect(resolveFriendlyTz('Etc/GMT+7', '2026-06-19', 'America/Los_Angeles')).toBe(
			'America/Los_Angeles'
		);
	});

	test('scans supported timezones and returns a matching IANA zone if fallback does not match', () => {
		// Etc/GMT-8 represents offset +8 (e.g. Asia/Singapore or Asia/Hong_Kong)
		const resolved = resolveFriendlyTz('Etc/GMT-8', '2026-06-19', 'America/New_York');
		expect(resolved).not.toBe('America/New_York');
		expect(resolved).not.toContain('Etc/');
		expect(resolved).toContain('/');
		// Check that the resolved zone actually has offset +08:00 on that date
		const zdt = Temporal.PlainDate.from('2026-06-19').toZonedDateTime(resolved);
		expect(zdt.offset).toBe('+08:00');
	});
});
