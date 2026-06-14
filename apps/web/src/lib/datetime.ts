import { Temporal } from '@js-temporal/polyfill';

/** Long date from a `YYYY-MM-DD` key, e.g. "Monday, June 15". */
export function formatDate(key: string): string {
	try {
		return Temporal.PlainDate.from(key).toLocaleString(undefined, {
			weekday: 'long',
			month: 'long',
			day: 'numeric'
		});
	} catch {
		return key;
	}
}

/** Compact date from a `YYYY-MM-DD` key, e.g. "Sat, Nov 15". */
export function formatDateCompact(key: string): string {
	try {
		return Temporal.PlainDate.from(key).toLocaleString(undefined, {
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
		return Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toLocaleString(undefined, {
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
		return Temporal.Instant.from(iso)
			.toZonedDateTimeISO(tz)
			.toLocaleString(undefined, { weekday: 'long' });
	} catch {
		return '';
	}
}

/** Time of day from an instant in `tz`, e.g. "09:30 AM". */
export function formatTime(iso: string, tz: string): string {
	try {
		return Temporal.Instant.from(iso)
			.toZonedDateTimeISO(tz)
			.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
	} catch {
		return iso;
	}
}

/** Compact time of day in `tz`, no leading zero, lowercase meridiem, e.g. "1:00pm". */
export function formatTimeShort(iso: string, tz: string): string {
	try {
		return Temporal.Instant.from(iso)
			.toZonedDateTimeISO(tz)
			.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
			.replace(/\s+/g, '')
			.toLowerCase();
	} catch {
		return iso;
	}
}

/** Time range across two instants in `tz`, e.g. "09:00 AM – 09:30 AM". */
export function formatTimeRange(start: string, end: string, tz: string): string {
	try {
		const time = (iso: string) =>
			Temporal.Instant.from(iso)
				.toZonedDateTimeISO(tz)
				.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
		return `${time(start)} – ${time(end)}`;
	} catch {
		return `${start} – ${end}`;
	}
}

/** Weekday, date, and time from an instant in `tz`, e.g. "Mon, Jun 15, 09:30 AM". */
export function formatSlot(iso: string, tz: string): string {
	try {
		return Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toLocaleString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
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
		const date = new Date(Temporal.Instant.from(iso).epochMilliseconds);
		const parts = new Intl.DateTimeFormat('en', {
			timeZone: tz,
			timeZoneName: 'short'
		}).formatToParts(date);
		return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
	} catch {
		return '';
	}
}
