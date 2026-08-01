import * as CalendarFns from 'temporal-polyfill/fns/Calendar';
import * as PlainDateFns from 'temporal-polyfill/fns/PlainDate';
import * as InstantFns from 'temporal-polyfill/fns/Instant';
import * as ZonedDateTimeFns from 'temporal-polyfill/fns/ZonedDateTime';

/** Long date from a `YYYY-MM-DD` key, e.g. "Monday, June 15". */
export function formatDate(key: string): string {
	try {
		const dateObj = PlainDateFns.fromString(key, CalendarFns.getAny);
		return PlainDateFns.toLocaleString(dateObj, undefined, {
			weekday: 'long',
			month: 'long',
			day: 'numeric'
		});
	} catch {
		return key;
	}
}

/** `YYYY-MM-DD` day key for an instant, in the given timezone. */
export function instantToDateKey(iso: string, tz: string): string {
	try {
		const inst = InstantFns.fromString(iso);
		const zdt = InstantFns.toZonedDateTimeISO(inst, tz);
		const dateObj = ZonedDateTimeFns.toPlainDate(zdt);
		return PlainDateFns.toString(dateObj);
	} catch {
		return iso;
	}
}

/** Compact date from a `YYYY-MM-DD` key, e.g. "Sat, Nov 15". */
export function formatDateCompact(key: string): string {
	try {
		const dateObj = PlainDateFns.fromString(key, CalendarFns.getAny);
		return PlainDateFns.toLocaleString(dateObj, undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	} catch {
		return key;
	}
}

/** Numeric date from an instant in `tz`, e.g. "6/15/2025". */
export function formatDateShort(iso: string, tz: string): string {
	try {
		const inst = InstantFns.fromString(iso);
		const zdt = InstantFns.toZonedDateTimeISO(inst, tz);
		return ZonedDateTimeFns.toLocaleString(zdt, undefined, {
			year: 'numeric',
			month: 'numeric',
			day: 'numeric'
		});
	} catch {
		return iso;
	}
}

/** Weekday name from an instant in `tz`, e.g. "Monday". */
export function formatWeekday(iso: string, tz: string): string {
	try {
		const inst = InstantFns.fromString(iso);
		const zdt = InstantFns.toZonedDateTimeISO(inst, tz);
		return ZonedDateTimeFns.toLocaleString(zdt, undefined, { weekday: 'long' });
	} catch {
		return '';
	}
}

/** Time of day from an instant in `tz`, e.g. "09:30 AM". */
export function formatTime(iso: string, tz: string): string {
	try {
		const inst = InstantFns.fromString(iso);
		const zdt = InstantFns.toZonedDateTimeISO(inst, tz);
		let s = ZonedDateTimeFns.toLocaleString(zdt, undefined, { hour: '2-digit', minute: '2-digit' });
		if (/^\d:/.test(s)) {
			s = '0' + s;
		}
		return s;
	} catch {
		return iso;
	}
}

/** Compact time of day in `tz`, no leading zero, lowercase meridiem, e.g. "1:00pm". */
export function formatTimeShort(iso: string, tz: string): string {
	try {
		const inst = InstantFns.fromString(iso);
		const zdt = InstantFns.toZonedDateTimeISO(inst, tz);
		return ZonedDateTimeFns.toLocaleString(zdt, undefined, {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		})
			.replace(/\s+/g, '')
			.toLowerCase();
	} catch {
		return iso;
	}
}

/** Time range across two instants in `tz`, e.g. "09:00 AM – 09:30 AM". */
export function formatTimeRange(start: string, end: string, tz: string): string {
	try {
		const time = (iso: string) => formatTime(iso, tz);
		return `${time(start)} – ${time(end)}`;
	} catch {
		return `${start} – ${end}`;
	}
}

/** Weekday, date, and time from an instant in `tz`, e.g. "Mon, Jun 15, 09:30 AM". */
export function formatSlot(iso: string, tz: string): string {
	try {
		const inst = InstantFns.fromString(iso);
		const zdt = InstantFns.toZonedDateTimeISO(inst, tz);
		const s = ZonedDateTimeFns.toLocaleString(zdt, undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
		return s.replace(/(,\s+)(\d:\d{2}\s+[A-Z]{2})$/, '$10$2');
	} catch {
		return iso;
	}
}

/** Log-style timestamp from an instant in `tz`, e.g. "2025-06-15 14:30:45". */
export function formatTimestamp(iso: string, tz: string): string {
	try {
		const inst = InstantFns.fromString(iso);
		const z = InstantFns.toZonedDateTimeISO(inst, tz);
		const p = (n: number) => String(n).padStart(2, '0');
		return `${z.year}-${p(z.month)}-${p(z.day)} ${p(z.hour)}:${p(z.minute)}:${p(z.second)}`;
	} catch {
		return iso;
	}
}

/** City portion of an IANA timezone, e.g. "America/New_York" → "New York". */
export function tzCity(tz: string): string {
	return tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
}

/** Short UTC offset for a timezone right now, e.g. "GMT-4". Empty string on failure. */
export function tzOffset(tz: string): string {
	try {
		const fmt = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' });
		const parts = fmt.formatToParts(new Date());
		return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
	} catch {
		return '';
	}
}

/** Timezone as "City · offset", e.g. "New York · GMT-4". */
export function formatTzShort(tz: string): string {
	const city = tzCity(tz);
	const offset = tzOffset(tz);
	return offset ? `${city} · ${offset}` : city;
}

/** Timezone abbreviation for an instant in `tz`, e.g. "PDT". Falls back to "GMT-7". */
export function formatTzAbbrev(iso: string, tz: string): string {
	try {
		const inst = InstantFns.fromString(iso);
		const date = new Date(inst.epochMilliseconds);
		const parts = new Intl.DateTimeFormat('en', {
			timeZone: tz,
			timeZoneName: 'short'
		}).formatToParts(date);
		return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
	} catch {
		return '';
	}
}

const STEPS: [seconds: number, unit: Intl.RelativeTimeFormatUnit, per: number][] = [
	[60, 'second', 1],
	[3600, 'minute', 60],
	[86400, 'hour', 3600],
	[604800, 'day', 86400],
	[2629800, 'week', 604800],
	[31557600, 'month', 2629800]
];

export function timeAgo(iso: string | null, now: number = Date.now()): string {
	if (!iso) return 'unknown';

	const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
	if (seconds < 45) return 'just now';

	// 'always' keeps a status line consistent: "1 day ago", never "yesterday".
	const format = new Intl.RelativeTimeFormat([], { numeric: 'always' });

	for (const [limit, unit, per] of STEPS) {
		if (seconds < limit) return format.format(-Math.round(seconds / per), unit);
	}
	return format.format(-Math.round(seconds / 31557600), 'year');
}
