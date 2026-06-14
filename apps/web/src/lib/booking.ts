import { Temporal } from '@js-temporal/polyfill';
import { formatTime } from './datetime';

export type WizardStep = 1 | 2 | 3;

/** All slot instants across every date, flattened. */
export function flattenSlots(slotsByDate: Record<string, string[]>): string[] {
	return Object.values(slotsByDate).flat();
}

/** The server's day keys (host tz) straight from the slot buckets, before any re-bucketing. */
export function dateKeys(slotsByDate: Record<string, string[]>): Set<string> {
	return new Set(Object.keys(slotsByDate));
}

/** The set of `YYYY-MM-DD` keys that have at least one slot, in the given timezone. */
export function availableDates(slots: string[], tz: string): Set<string> {
	const dates = new Set<string>();
	for (const iso of slots) {
		dates.add(Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainDate().toString());
	}
	return dates;
}

/** Slots that fall on `dateKey` in the given timezone, sorted ascending. */
export function slotsOnDate(slots: string[], dateKey: string, tz: string): string[] {
	return slots
		.filter(
			(iso) =>
				Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainDate().toString() === dateKey
		)
		.sort();
}

/** Whether the wizard can move past the current step given what's been picked. */
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
	tz?: string;
	/** The requested value when it's no longer bookable; drives the stale-link banner. */
	notice?: { kind: 'slot'; requested: string } | { kind: 'date'; requested: string };
}

export function isLocalTime(s: string): boolean {
	return /^(?:[01]\d|2[0-3]):?[0-5]\d$/.test(s);
}

export function isValidTz(tz: string): boolean {
	if (/^-?\d{4}$/.test(tz)) return true;
	try {
		Intl.DateTimeFormat(undefined, { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

export function parseTzOffset(offset: string): string {
	if (!offset) return 'UTC';
	if (offset === '0000' || offset === 'Z') return 'UTC';

	const match = /^([+-])?(\d{2})(\d{2})$/.exec(offset);
	if (!match) {
		try {
			Intl.DateTimeFormat(undefined, { timeZone: offset });
			return offset;
		} catch {
			return 'UTC';
		}
	}

	const sign = match[1] === '-' ? '-' : '+';
	const hours = Number(match[2]);
	const minutes = Number(match[3]);

	if (minutes === 0) {
		const invertedSign = sign === '+' ? '-' : '+';
		return `Etc/GMT${invertedSign}${hours}`;
	}

	return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatTzOffset(tz: string, date: string): string {
	try {
		const zdt = Temporal.PlainDate.from(date).toZonedDateTime(tz);
		const offset = zdt.offset; // e.g. "-07:00", "+08:00", "Z"
		if (offset === 'Z') return '0000';
		return offset.replace(/:/g, '').replace(/^\+/, '');
	} catch {
		return '0000';
	}
}

export function resolveFriendlyTz(tz: string, date: string, fallbackTz: string): string {
	if (tz.includes('/') && !tz.startsWith('Etc/')) {
		return tz;
	}

	try {
		const targetZdt = Temporal.PlainDate.from(date).toZonedDateTime(tz);
		const targetOffsetNs = targetZdt.offsetNanoseconds;

		try {
			const fallbackZdt = Temporal.PlainDate.from(date).toZonedDateTime(fallbackTz);
			if (
				fallbackZdt.offsetNanoseconds === targetOffsetNs &&
				fallbackTz.includes('/') &&
				!fallbackTz.startsWith('Etc/')
			) {
				return fallbackTz;
			}
		} catch {
			// Ignore
		}

		const allTzs = Intl.supportedValuesOf('timeZone');
		for (const t of allTzs) {
			if (t.includes('/') && !t.startsWith('Etc/')) {
				try {
					const zdt = Temporal.PlainDate.from(date).toZonedDateTime(t);
					if (zdt.offsetNanoseconds === targetOffsetNs) {
						return t;
					}
				} catch {
					// Ignore
				}
			}
		}
	} catch {
		// Ignore
	}

	return tz;
}

/**
 * Maps `?date=`/`?slot=`/`?tz=` deep-link params to a starting wizard step.
 * If `date` and `tz` are provided, it resolves availability. If `slot` is also provided,
 * it resolves the absolute instant and checks if it's currently bookable.
 * If the parameters or slot/date are no longer bookable, it drops to step 1 with a notice.
 */
export function resolveDeepLink(p: {
	slotParam: string | null;
	dateParam: string | null;
	tzParam: string | null;
	allSlots: string[];
	defaultTz: string;
}): DeepLinkResult {
	const tz = p.tzParam ? parseTzOffset(p.tzParam) : p.defaultTz;

	if (p.dateParam && isDateKey(p.dateParam)) {
		if (p.slotParam && isLocalTime(p.slotParam)) {
			try {
				let timeStr = p.slotParam;
				if (!timeStr.includes(':')) {
					timeStr = `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}`;
				}
				const zdt = Temporal.PlainDateTime.from(`${p.dateParam}T${timeStr}`).toZonedDateTime(tz);
				const instantStr = zdt.toInstant().toString();
				if (p.allSlots.includes(instantStr)) {
					return { step: 3, slot: instantStr, date: p.dateParam, tz };
				}
				const dates = availableDates(p.allSlots, tz);
				if (dates.has(p.dateParam)) {
					return { step: 2, date: p.dateParam, notice: { kind: 'slot', requested: instantStr }, tz };
				}
				return { step: 1, notice: { kind: 'slot', requested: instantStr }, tz };
			} catch {
				// Parse error or validation error, fallback to date check
			}
		}

		const dates = availableDates(p.allSlots, tz);
		if (dates.has(p.dateParam)) {
			return { step: 2, date: p.dateParam, tz };
		}
		return { step: 1, notice: { kind: 'date', requested: p.dateParam }, tz };
	}

	return { step: 1, tz };
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

export function normalizeDeepLinkParams(
	params: URLSearchParams,
	defaultTz: string
): { date?: string; slot?: string; tz?: string } {
	const date = params.get('date');
	const slot = params.get('slot');
	const tz = params.get('tz');

	const hasDateParam = params.has('date');
	const hasSlotParam = params.has('slot');
	const hasTzParam = params.has('tz');

	// If date is requested but is illegal, reject the whole deep link.
	if (hasDateParam && (!date || !isDateKey(date))) {
		return {};
	}

	// If slot is requested but is illegal, strip it.
	const validSlot = hasSlotParam && slot && isLocalTime(slot) ? slot : null;

	// If tz is requested but is illegal, strip it.
	// Otherwise if missing, default to defaultTz.
	let resolvedTz: string | null = null;
	if (hasTzParam) {
		if (tz && isValidTz(tz)) {
			resolvedTz = tz;
		}
	} else {
		resolvedTz = defaultTz;
	}

	if (date && isDateKey(date)) {
		const result: { date: string; slot?: string; tz?: string } = { date };

		if (resolvedTz) {
			result.tz = formatTzOffset(parseTzOffset(resolvedTz), date);
		}

		if (validSlot) {
			result.slot = validSlot.replace(/:/g, ''); // HHMM
		}

		return result;
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
