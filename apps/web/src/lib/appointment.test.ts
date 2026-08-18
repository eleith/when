import { describe, expect, test } from 'vitest';
import {
	flattenSlots,
	availableDates,
	slotsOnDate,
	canAdvance,
	resolveDeepLink,
	normalizeDeepLinkParams,
	buildDayTimeline,
	isInTimelineBlock,
	isTimelineUnavailable,
	nearestTimelineSlot,
	isDirectSlotHit,
	desiredUrlState,
	urlStateMatches,
	buildAppointmentSearch
} from './appointment';

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
	const base = { slotParam: null, dateParam: null, allSlots, tz: 'UTC' };

	test('no params → step 1', () => {
		expect(resolveDeepLink(base)).toEqual({ step: 1 });
	});

	test('valid date → step 2', () => {
		expect(resolveDeepLink({ ...base, dateParam: '2025-06-15' })).toEqual({
			step: 2,
			date: '2025-06-15'
		});
	});

	test('stale date → step 1 with a date notice', () => {
		expect(resolveDeepLink({ ...base, dateParam: '2025-06-20' })).toEqual({
			step: 1,
			notice: { kind: 'date', requested: '2025-06-20' }
		});
	});

	test('slot instant in availability → step 3', () => {
		expect(resolveDeepLink({ ...base, slotParam: '2025-06-15T09:30:00Z' })).toEqual({
			step: 3,
			slot: '2025-06-15T09:30:00Z'
		});
	});

	test('slot matching is zone-agnostic and canonicalizes offset forms', () => {
		// 2025-06-16T08:30:00+09:00 is the same instant as 2025-06-15T23:30:00Z, which is bookable.
		expect(resolveDeepLink({ ...base, slotParam: '2025-06-16T08:30:00+09:00' })).toEqual({
			step: 3,
			slot: '2025-06-15T23:30:00Z'
		});
	});

	test('stale slot on an available day → step 2 with a slot notice', () => {
		expect(resolveDeepLink({ ...base, slotParam: '2025-06-15T12:00:00Z' })).toEqual({
			step: 2,
			date: '2025-06-15',
			notice: { kind: 'slot', requested: '2025-06-15T12:00:00Z' }
		});
	});

	test('stale slot on an unavailable day → step 1 with a slot notice', () => {
		expect(resolveDeepLink({ ...base, slotParam: '2025-06-20T12:00:00Z' })).toEqual({
			step: 1,
			notice: { kind: 'slot', requested: '2025-06-20T12:00:00Z' }
		});
	});

	test('a stale slot opens its day in the viewer zone', () => {
		// 2025-06-15T15:00:00Z is unbooked; in UTC it falls on the 15th, in Tokyo on the 16th.
		expect(resolveDeepLink({ ...base, slotParam: '2025-06-15T15:00:00Z' })).toEqual({
			step: 2,
			date: '2025-06-15',
			notice: { kind: 'slot', requested: '2025-06-15T15:00:00Z' }
		});
		expect(
			resolveDeepLink({ ...base, slotParam: '2025-06-15T15:00:00Z', tz: 'Asia/Tokyo' })
		).toEqual({
			step: 2,
			date: '2025-06-16',
			notice: { kind: 'slot', requested: '2025-06-15T15:00:00Z' }
		});
	});
});

describe('normalizeDeepLinkParams', () => {
	const norm = (q: string) => normalizeDeepLinkParams(new URLSearchParams(q));

	test('keeps a valid date', () => {
		expect(norm('date=2026-06-19')).toEqual({ date: '2026-06-19' });
	});

	test('keeps a valid slot instant', () => {
		expect(norm('slot=2026-06-19T18:30:00Z')).toEqual({ slot: '2026-06-19T18:30:00Z' });
	});

	test('canonicalizes an offset slot to its UTC instant', () => {
		expect(norm('slot=2026-06-19T14:30:00-04:00')).toEqual({ slot: '2026-06-19T18:30:00Z' });
	});

	test('slot wins over date and drops the redundant date', () => {
		expect(norm('date=2026-06-19&slot=2026-06-20T18:30:00Z')).toEqual({
			slot: '2026-06-20T18:30:00Z'
		});
	});

	test('drops a malformed date', () => {
		expect(norm('date=2026-13-99')).toEqual({});
	});

	test('falls back to a valid date when the slot is malformed', () => {
		expect(norm('date=2026-06-19&slot=abc')).toEqual({ date: '2026-06-19' });
	});

	test('drops a malformed slot with no date', () => {
		expect(norm('slot=abc')).toEqual({});
	});

	test('drops unknown keys (nothing valid remains)', () => {
		expect(norm('foo=bar')).toEqual({});
	});

	test('keeps a valid duration alongside a slot', () => {
		expect(norm('duration=60&slot=2026-06-19T18:30:00Z')).toEqual({
			duration: 60,
			slot: '2026-06-19T18:30:00Z'
		});
	});

	test('keeps a bare duration', () => {
		expect(norm('duration=45')).toEqual({ duration: 45 });
	});

	test('drops a non-positive or malformed duration', () => {
		expect(norm('duration=0')).toEqual({});
		expect(norm('duration=abc')).toEqual({});
	});
});

describe('buildDayTimeline', () => {
	// A 09:00–17:00 UTC working day, one busy hour at noon, two 30-min slots.
	const base = {
		viewDate: '2025-06-15',
		workingWindows: [{ start: '2025-06-15T09:00:00Z', end: '2025-06-15T17:00:00Z' }],
		busyBlocks: [{ start: '2025-06-15T12:00:00Z', end: '2025-06-15T13:00:00Z' }],
		eventType: { duration_minutes: 30 },
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
			eventType: { duration_minutes: 30, padding_before_minutes: 30, padding_after_minutes: 30 }
		})!;
		// 11:30–13:30 → 35%, two hours tall (height is float math, hence closeTo)
		expect(t.buffers).toHaveLength(1);
		expect(t.buffers[0].top).toBe(35);
		expect(t.buffers[0].height).toBeCloseTo(20);
	});

	test('places slots by start and duration, flagging the original', () => {
		const t = buildDayTimeline({ ...base, originalSlot: '2025-06-15T09:30:00Z' })!;
		expect(t.slots).toEqual([
			{
				iso: '2025-06-15T09:00:00Z',
				time: '09:00 AM',
				endTime: '09:30 AM',
				top: 10,
				height: 5,
				isOriginal: false
			},
			{
				iso: '2025-06-15T09:30:00Z',
				time: '09:30 AM',
				endTime: '10:00 AM',
				top: 15,
				height: 5,
				isOriginal: true
			}
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

describe('desiredUrlState', () => {
	const base = {
		duration: 30,
		defaultDuration: 30,
		step: 1 as const,
		selectedSlot: null,
		viewDate: null
	};

	test('omits the duration when it is the default length', () => {
		expect(desiredUrlState(base).duration).toBeNull();
	});

	test('encodes a non-default duration', () => {
		expect(desiredUrlState({ ...base, duration: 60 }).duration).toBe('60');
	});

	test('prefers the slot once picked on the details step', () => {
		expect(
			desiredUrlState({
				...base,
				step: 3,
				selectedSlot: '2025-06-15T09:00:00Z',
				viewDate: '2025-06-15'
			})
		).toEqual({ duration: null, slot: '2025-06-15T09:00:00Z', date: null });
	});

	test('encodes the viewed day off the details step', () => {
		expect(desiredUrlState({ ...base, step: 2, viewDate: '2025-06-15' })).toEqual({
			duration: null,
			slot: null,
			date: '2025-06-15'
		});
	});

	test('ignores a selected slot until the details step', () => {
		expect(
			desiredUrlState({
				...base,
				step: 2,
				selectedSlot: '2025-06-15T09:00:00Z',
				viewDate: '2025-06-15'
			}).slot
		).toBeNull();
	});
});

describe('urlStateMatches', () => {
	test('is true only when every param matches', () => {
		const params = new URLSearchParams('duration=60&date=2025-06-15');
		expect(urlStateMatches(params, { duration: '60', slot: null, date: '2025-06-15' })).toBe(true);
		expect(urlStateMatches(params, { duration: null, slot: null, date: '2025-06-15' })).toBe(false);
	});
});

describe('buildAppointmentSearch', () => {
	test('orders duration before slot', () => {
		expect(
			buildAppointmentSearch({ duration: '60', slot: '2025-06-15T09:00:00Z', date: null })
		).toBe('?duration=60&slot=2025-06-15T09%3A00%3A00Z');
	});

	test('slot wins over date', () => {
		expect(
			buildAppointmentSearch({ duration: null, slot: '2025-06-15T09:00:00Z', date: '2025-06-15' })
		).toBe('?slot=2025-06-15T09%3A00%3A00Z');
	});

	test('is empty when nothing is set', () => {
		expect(buildAppointmentSearch({ duration: null, slot: null, date: null })).toBe('');
	});
});

describe('isInTimelineBlock', () => {
	const blocks = [{ top: 10, height: 20 }];

	test('returns true when percentage falls inside a block', () => {
		expect(isInTimelineBlock(10, blocks)).toBe(true);
		expect(isInTimelineBlock(20, blocks)).toBe(true);
		expect(isInTimelineBlock(30, blocks)).toBe(true);
	});

	test('returns false when percentage is outside', () => {
		expect(isInTimelineBlock(9, blocks)).toBe(false);
		expect(isInTimelineBlock(31, blocks)).toBe(false);
	});

	test('returns false for undefined or empty blocks', () => {
		expect(isInTimelineBlock(15, undefined)).toBe(false);
		expect(isInTimelineBlock(15, [])).toBe(false);
	});
});

describe('isTimelineUnavailable', () => {
	const timeline = {
		totalMs: 36000000,
		working: [{ top: 10, height: 80 }],
		busy: [{ top: 40, height: 10 }],
		buffers: [{ top: 35, height: 20 }],
		past: { top: 0, height: 15 },
		slots: [],
		labels: []
	};

	test('returns true when outside working windows', () => {
		expect(isTimelineUnavailable(timeline, 5)).toBe(true);
		expect(isTimelineUnavailable(timeline, 95)).toBe(true);
	});

	test('returns true when in past cutoff', () => {
		expect(isTimelineUnavailable(timeline, 12)).toBe(true);
	});

	test('returns true when inside busy or buffer block', () => {
		expect(isTimelineUnavailable(timeline, 37)).toBe(true); // in buffer
		expect(isTimelineUnavailable(timeline, 45)).toBe(true); // in busy
	});

	test('returns false when in available working time', () => {
		expect(isTimelineUnavailable(timeline, 25)).toBe(false);
		expect(isTimelineUnavailable(timeline, 60)).toBe(false);
	});

	test('returns true if timeline is null', () => {
		expect(isTimelineUnavailable(null, 25)).toBe(true);
	});
});

describe('nearestTimelineSlot', () => {
	const slots = [
		{
			iso: '2025-06-15T09:00:00Z',
			time: '9:00 AM',
			endTime: '9:30 AM',
			top: 10,
			height: 5,
			isOriginal: false
		},
		{
			iso: '2025-06-15T09:30:00Z',
			time: '9:30 AM',
			endTime: '10:00 AM',
			top: 15,
			height: 5,
			isOriginal: false
		}
	];

	test('returns slot with closest center', () => {
		expect(nearestTimelineSlot(slots, 11)?.iso).toBe('2025-06-15T09:00:00Z');
		expect(nearestTimelineSlot(slots, 16)?.iso).toBe('2025-06-15T09:30:00Z');
	});

	test('returns null for empty slots list', () => {
		expect(nearestTimelineSlot([], 10)).toBeNull();
	});
});

describe('isDirectSlotHit', () => {
	const slot = {
		iso: '2025-06-15T09:00:00Z',
		time: '9:00 AM',
		endTime: '9:30 AM',
		top: 10,
		height: 5,
		isOriginal: false
	};

	test('returns true within slot bounds', () => {
		expect(isDirectSlotHit(slot, 10)).toBe(true);
		expect(isDirectSlotHit(slot, 12.5)).toBe(true);
		expect(isDirectSlotHit(slot, 15)).toBe(true);
	});

	test('returns false outside slot bounds', () => {
		expect(isDirectSlotHit(slot, 9.9)).toBe(false);
		expect(isDirectSlotHit(slot, 15.1)).toBe(false);
	});
});
