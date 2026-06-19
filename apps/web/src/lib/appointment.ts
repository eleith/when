import { Temporal } from '@js-temporal/polyfill';
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
		dates.add(Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainDate().toString());
	}
	return dates;
}

export function slotsOnDate(slots: string[], dateKey: string, tz: string): string[] {
	return slots
		.filter(
			(iso) =>
				Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainDate().toString() === dateKey
		)
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
		Temporal.Instant.from(s);
		return true;
	} catch {
		return false;
	}
}

function isDateKey(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	try {
		Temporal.PlainDate.from(s);
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
		const instant = Temporal.Instant.from(p.slotParam).toString();
		if (p.allSlots.includes(instant)) {
			return { step: 3, slot: instant };
		}
		const date = Temporal.Instant.from(instant).toZonedDateTimeISO(p.tz).toPlainDate().toString();
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

export function normalizeDeepLinkParams(params: URLSearchParams): { date?: string; slot?: string } {
	const slot = params.get('slot');
	if (params.has('slot') && slot && isInstant(slot)) {
		return { slot: Temporal.Instant.from(slot).toString() };
	}

	const date = params.get('date');
	if (params.has('date') && date && isDateKey(date)) {
		return { date };
	}

	return {};
}

export interface TimelineEventType {
	duration: number;
	buffer_before?: number | null;
	buffer_after?: number | null;
	minimum_notice?: number | null;
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
	now?: Temporal.Instant;
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
	now = Temporal.Now.instant()
}: BuildDayTimelineParams): DayTimeline | null {
	const dateObj = Temporal.PlainDate.from(viewDate);
	const startOfDay = dateObj.toZonedDateTime(tz).toInstant();
	const endOfDay = dateObj.add({ days: 1 }).toZonedDateTime(tz).toInstant();

	const dayWindows = workingWindows
		.map((w) => ({
			start: Temporal.Instant.from(w.start),
			end: Temporal.Instant.from(w.end)
		}))
		.filter(
			(w) =>
				Temporal.Instant.compare(w.start, endOfDay) < 0 &&
				Temporal.Instant.compare(w.end, startOfDay) > 0
		);

	if (dayWindows.length === 0) return null;

	let earliest = dayWindows[0].start;
	let latest = dayWindows[0].end;
	for (const w of dayWindows) {
		if (Temporal.Instant.compare(w.start, earliest) < 0) earliest = w.start;
		if (Temporal.Instant.compare(w.end, latest) > 0) latest = w.end;
	}

	let viewStart = earliest.subtract({ hours: 1 });
	if (Temporal.Instant.compare(viewStart, startOfDay) < 0) viewStart = startOfDay;

	let viewEnd = latest.add({ hours: 1 });
	if (Temporal.Instant.compare(viewEnd, endOfDay) > 0) viewEnd = endOfDay;

	const totalMs = Number(viewEnd.epochMilliseconds - viewStart.epochMilliseconds);
	if (totalMs <= 0) return null;

	const toPercent = (inst: Temporal.Instant) => {
		const ms = Number(inst.epochMilliseconds - viewStart.epochMilliseconds);
		return Math.max(0, Math.min(100, (ms / totalMs) * 100));
	};

	const busy = busyBlocks
		.map((b) => ({
			start: Temporal.Instant.from(b.start),
			end: Temporal.Instant.from(b.end)
		}))
		.filter(
			(b) =>
				Temporal.Instant.compare(b.start, viewEnd) < 0 &&
				Temporal.Instant.compare(b.end, viewStart) > 0
		)
		.map((b) => ({
			top: toPercent(b.start),
			height: toPercent(b.end) - toPercent(b.start)
		}));

	const buffers = busyBlocks
		.map((b) => {
			const start = Temporal.Instant.from(b.start).subtract({
				minutes: eventType.buffer_before ?? 0
			});
			const end = Temporal.Instant.from(b.end).add({ minutes: eventType.buffer_after ?? 0 });
			return { start, end };
		})
		.filter(
			(b) =>
				Temporal.Instant.compare(b.start, viewEnd) < 0 &&
				Temporal.Instant.compare(b.end, viewStart) > 0
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
		const start = Temporal.Instant.from(iso);
		const end = start.add({ minutes: eventType.duration });
		return {
			iso,
			time: formatTime(iso, tz),
			top: toPercent(start),
			height: toPercent(end) - toPercent(start),
			isOriginal: iso === originalSlot
		};
	});

	const labels: TimelineLabel[] = [];
	let current = viewStart
		.toZonedDateTimeISO(tz)
		.with({ minute: 0, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
	if (Temporal.Instant.compare(current.toInstant(), viewStart) < 0) {
		current = current.add({ hours: 1 });
	}
	while (Temporal.Instant.compare(current.toInstant(), viewEnd) < 0) {
		labels.push({
			label: current.toLocaleString(undefined, { hour: 'numeric' }),
			top: toPercent(current.toInstant())
		});
		current = current.add({ hours: 1 });
	}

	let past: TimelineBlock | null = null;
	const noticeInst = now.add({
		minutes: (eventType.minimum_notice ?? 0) + (eventType.buffer_before ?? 0)
	});

	if (Temporal.Instant.compare(noticeInst, viewStart) > 0) {
		if (Temporal.Instant.compare(noticeInst, viewEnd) >= 0) {
			past = { top: 0, height: 100 };
		} else {
			past = { top: 0, height: toPercent(noticeInst) };
		}
	}

	return { totalMs, working, busy, buffers, past, slots, labels };
}
