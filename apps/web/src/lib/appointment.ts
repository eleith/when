import * as CalendarFns from 'temporal-polyfill/fns/Calendar';
import * as PlainDateFns from 'temporal-polyfill/fns/PlainDate';
import * as InstantFns from 'temporal-polyfill/fns/Instant';
import * as ZonedDateTimeFns from 'temporal-polyfill/fns/ZonedDateTime';
import * as NowFns from 'temporal-polyfill/fns/Now';
import { formatTime } from './datetime';

export type WizardStep = 1 | 2 | 3;

export function flattenSlots(slotsByDate: Record<string, string[]>): string[] {
	return Object.values(slotsByDate).flat();
}

export function dateKeys(slotsByDate: Record<string, string[]>): Set<string> {
	return new Set(Object.keys(slotsByDate));
}

export function availableDates(slots: string[], tz: string): Set<string> {
	const dates = new Set<string>();
	for (const iso of slots) {
		const inst = InstantFns.fromString(iso);
		const zdt = InstantFns.toZonedDateTimeISO(inst, tz);
		const plainDate = ZonedDateTimeFns.toPlainDate(zdt);
		dates.add(PlainDateFns.toString(plainDate));
	}
	return dates;
}

export function slotsOnDate(slots: string[], dateKey: string, tz: string): string[] {
	return slots
		.filter((iso) => {
			const inst = InstantFns.fromString(iso);
			const zdt = InstantFns.toZonedDateTimeISO(inst, tz);
			const plainDate = ZonedDateTimeFns.toPlainDate(zdt);
			return PlainDateFns.toString(plainDate) === dateKey;
		})
		.sort();
}

export function canAdvance(
	step: WizardStep,
	viewDate: string | null,
	selectedSlot: string | null
): boolean {
	if (step === 1) return viewDate != null;
	if (step === 2) return selectedSlot != null;
	return true;
}

export interface DeepLinkResult {
	step: WizardStep;
	slot?: string;
	date?: string;
	notice?: { kind: 'slot'; requested: string } | { kind: 'date'; requested: string };
}

function isInstant(s: string): boolean {
	try {
		InstantFns.fromString(s);
		return true;
	} catch {
		return false;
	}
}

function isDateKey(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	try {
		PlainDateFns.fromString(s, CalendarFns.getAny);
		return true;
	} catch {
		return false;
	}
}

/**
 * Maps zone-agnostic `?slot=`/`?date=` deep-link params to a starting wizard step.
 * `slot` is an absolute instant matched directly against availability; `date` is a day
 * key opened in the viewer's zone (`tz`). A stale slot or empty day drops back with a notice.
 */
export function resolveDeepLink(p: {
	slotParam: string | null;
	dateParam: string | null;
	allSlots: string[];
	tz: string;
}): DeepLinkResult {
	if (p.slotParam && isInstant(p.slotParam)) {
		const instant = InstantFns.toString(InstantFns.fromString(p.slotParam));
		if (p.allSlots.includes(instant)) {
			return { step: 3, slot: instant };
		}
		const inst = InstantFns.fromString(instant);
		const zdt = InstantFns.toZonedDateTimeISO(inst, p.tz);
		const date = PlainDateFns.toString(ZonedDateTimeFns.toPlainDate(zdt));
		if (availableDates(p.allSlots, p.tz).has(date)) {
			return { step: 2, date, notice: { kind: 'slot', requested: instant } };
		}
		return { step: 1, notice: { kind: 'slot', requested: instant } };
	}

	if (p.dateParam && isDateKey(p.dateParam)) {
		if (availableDates(p.allSlots, p.tz).has(p.dateParam)) {
			return { step: 2, date: p.dateParam };
		}
		return { step: 1, notice: { kind: 'date', requested: p.dateParam } };
	}

	return { step: 1 };
}

export function normalizeDeepLinkParams(params: URLSearchParams): {
	date?: string;
	slot?: string;
	duration?: number;
} {
	const result: { date?: string; slot?: string; duration?: number } = {};

	const duration = params.get('duration');
	if (duration && /^[1-9]\d*$/.test(duration)) {
		result.duration = Number(duration);
	}

	const slot = params.get('slot');
	if (params.has('slot') && slot && isInstant(slot)) {
		result.slot = InstantFns.toString(InstantFns.fromString(slot));
		return result;
	}

	const date = params.get('date');
	if (params.has('date') && date && isDateKey(date)) {
		result.date = date;
		return result;
	}

	return result;
}

export interface TimelineEventType {
	duration_minutes: number;
	padding_before_minutes?: number | null;
	padding_after_minutes?: number | null;
	notice_minutes?: number | null;
}

/** A vertical band on the timeline, positioned as percentages of the day view. */
export interface TimelineBlock {
	top: number;
	height: number;
}

export interface TimelineSlot extends TimelineBlock {
	iso: string;
	time: string;
	isOriginal: boolean;
}

export interface TimelineLabel {
	label: string;
	top: number;
}

export interface DayTimeline {
	totalMs: number;
	working: TimelineBlock[];
	busy: TimelineBlock[];
	buffers: TimelineBlock[];
	past: TimelineBlock | null;
	slots: TimelineSlot[];
	labels: TimelineLabel[];
}

export interface BuildDayTimelineParams {
	viewDate: string;
	workingWindows: { start: string; end: string }[];
	busyBlocks: { start: string; end: string }[];
	eventType: TimelineEventType;
	daySlots: string[];
	tz: string;
	originalSlot?: string | null;
	now?: InstantFns.Record | unknown;
}

function resolveInstant(inst: unknown): InstantFns.Record {
	if (InstantFns.isRecord(inst)) return inst;
	if (inst && typeof inst === 'object' && 'epochMilliseconds' in inst) {
		return InstantFns.fromEpochMilliseconds(
			Number((inst as { epochMilliseconds: number | bigint }).epochMilliseconds)
		);
	}
	return InstantFns.fromEpochMilliseconds(Date.now());
}

/**
 * Geometry for one day's timeline: working windows, busy/buffer bands, bookable
 * slots, hour labels, and the past/notice cutoff — all as top/height percentages
 * of the visible range (one hour padding around the working hours). Returns null
 * when the day has no working window. `now` is injectable for testing.
 */
export function buildDayTimeline({
	viewDate,
	workingWindows,
	busyBlocks,
	eventType,
	daySlots,
	tz,
	originalSlot = null,
	now
}: BuildDayTimelineParams): DayTimeline | null {
	const nowInst = now ? resolveInstant(now) : NowFns.instant();
	const dateObj = PlainDateFns.fromString(viewDate, CalendarFns.getAny);
	const startOfDay = ZonedDateTimeFns.toInstant(PlainDateFns.toZonedDateTime(dateObj, tz));
	const endOfDay = ZonedDateTimeFns.toInstant(
		PlainDateFns.toZonedDateTime(PlainDateFns.addDays(dateObj, 1), tz)
	);

	const dayWindows = workingWindows
		.map((w) => ({
			start: InstantFns.fromString(w.start),
			end: InstantFns.fromString(w.end)
		}))
		.filter(
			(w) => InstantFns.compare(w.start, endOfDay) < 0 && InstantFns.compare(w.end, startOfDay) > 0
		);

	if (dayWindows.length === 0) return null;

	let earliest = dayWindows[0].start;
	let latest = dayWindows[0].end;
	for (const w of dayWindows) {
		if (InstantFns.compare(w.start, earliest) < 0) earliest = w.start;
		if (InstantFns.compare(w.end, latest) > 0) latest = w.end;
	}

	let viewStart = InstantFns.subtractHours(earliest, 1);
	if (InstantFns.compare(viewStart, startOfDay) < 0) viewStart = startOfDay;

	let viewEnd = InstantFns.addHours(latest, 1);
	if (InstantFns.compare(viewEnd, endOfDay) > 0) viewEnd = endOfDay;

	const totalMs = viewEnd.epochMilliseconds - viewStart.epochMilliseconds;
	if (totalMs <= 0) return null;

	const toPercent = (inst: InstantFns.Record) => {
		const ms = inst.epochMilliseconds - viewStart.epochMilliseconds;
		return Math.max(0, Math.min(100, (ms / totalMs) * 100));
	};

	const busy = busyBlocks
		.map((b) => ({
			start: InstantFns.fromString(b.start),
			end: InstantFns.fromString(b.end)
		}))
		.filter(
			(b) => InstantFns.compare(b.start, viewEnd) < 0 && InstantFns.compare(b.end, viewStart) > 0
		)
		.map((b) => ({
			top: toPercent(b.start),
			height: toPercent(b.end) - toPercent(b.start)
		}));

	const buffers = busyBlocks
		.map((b) => {
			const start = InstantFns.subtractMinutes(
				InstantFns.fromString(b.start),
				eventType.padding_before_minutes ?? 0
			);
			const end = InstantFns.addMinutes(
				InstantFns.fromString(b.end),
				eventType.padding_after_minutes ?? 0
			);
			return { start, end };
		})
		.filter(
			(b) => InstantFns.compare(b.start, viewEnd) < 0 && InstantFns.compare(b.end, viewStart) > 0
		)
		.map((b) => ({
			top: toPercent(b.start),
			height: toPercent(b.end) - toPercent(b.start)
		}));

	const working = dayWindows.map((w) => ({
		top: toPercent(w.start),
		height: toPercent(w.end) - toPercent(w.start)
	}));

	const slots = daySlots.map((iso) => {
		const start = InstantFns.fromString(iso);
		const end = InstantFns.addMinutes(start, eventType.duration_minutes);
		return {
			iso,
			time: formatTime(iso, tz),
			top: toPercent(start),
			height: toPercent(end) - toPercent(start),
			isOriginal: iso === originalSlot
		};
	});

	const labels: TimelineLabel[] = [];
	const startZdt = InstantFns.toZonedDateTimeISO(viewStart, tz);
	let current = ZonedDateTimeFns.withFields(startZdt, {
		minute: 0,
		second: 0,
		millisecond: 0,
		microsecond: 0,
		nanosecond: 0
	});

	if (InstantFns.compare(ZonedDateTimeFns.toInstant(current), viewStart) < 0) {
		current = ZonedDateTimeFns.addHours(current, 1);
	}
	while (InstantFns.compare(ZonedDateTimeFns.toInstant(current), viewEnd) < 0) {
		labels.push({
			label: ZonedDateTimeFns.toLocaleString(current, undefined, { hour: 'numeric' }),
			top: toPercent(ZonedDateTimeFns.toInstant(current))
		});
		current = ZonedDateTimeFns.addHours(current, 1);
	}

	let past: TimelineBlock | null = null;
	const noticeInst = InstantFns.addMinutes(
		nowInst,
		(eventType.notice_minutes ?? 0) + (eventType.padding_before_minutes ?? 0)
	);

	if (InstantFns.compare(noticeInst, viewStart) > 0) {
		if (InstantFns.compare(noticeInst, viewEnd) >= 0) {
			past = { top: 0, height: 100 };
		} else {
			past = { top: 0, height: toPercent(noticeInst) };
		}
	}

	return { totalMs, working, busy, buffers, past, slots, labels };
}
