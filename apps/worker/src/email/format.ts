import { Temporal } from '@js-temporal/polyfill';
import { parseAttendeeAnswers, type EventType, type WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';
import type { DetailRow } from './content.js';
import type { BookingEmailInput } from './types.js';

export function eventTypeName(
	eventType: EventType | undefined,
	appointment: Pick<Appointment, 'event_type_id'>
): string {
	return eventType?.name ?? appointment.event_type_id;
}

export function attendeeLabel(a: Pick<Appointment, 'attendee_name' | 'attendee_email'>): string {
	return a.attendee_email ? `${a.attendee_name} <${a.attendee_email}>` : a.attendee_name;
}

export function answerRows(a: Pick<Appointment, 'attendee_answers'>): DetailRow[] {
	return parseAttendeeAnswers(a.attendee_answers).map((ans) => ({
		label: ans.label,
		value: ans.value
	}));
}

function tzShort(tz: string, atIso: string): string {
	try {
		const fmt = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' });
		const parts = fmt.formatToParts(new Date(atIso));
		return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
	} catch {
		return tz;
	}
}

export function fmtWhen(start: string, end: string, tz: string): string {
	try {
		const s = Temporal.Instant.from(start).toZonedDateTimeISO(tz);
		const e = Temporal.Instant.from(end).toZonedDateTimeISO(tz);
		const date = s.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
		const time = (z: Temporal.ZonedDateTime) =>
			z.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
		return `${date}, ${time(s)} – ${time(e)} (${tzShort(tz, start)})`;
	} catch {
		return `${start} – ${end}`;
	}
}

export function whenForAttendee(i: BookingEmailInput): string {
	const a = i.appointment;
	return fmtWhen(a.start_time, a.end_time, a.attendee_timezone ?? i.cfg.user.timezone);
}

export function whenForOrganizer(i: BookingEmailInput): string {
	const a = i.appointment;
	return fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);
}

export interface Brand {
	name: string;
	pageTitle: string;
	logoUrl?: string;
	primaryColor: string;
	onPrimary: string;
}

// Black or white, whichever reads better on the brand color (YIQ luminance).
function onColor(hex: string): string {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return '#ffffff';
	const h = m[1].length === 3 ? m[1].replace(/(.)/g, '$1$1') : m[1];
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return (r * 299 + g * 587 + b * 114) / 1000 >= 140 ? '#1a1a1a' : '#ffffff';
}

export function deriveBrand(cfg: WhenConfiguration, logoCid?: string): Brand {
	const branding = cfg.user.branding;
	const primaryColor = branding.color.primary.light;
	return {
		name: cfg.user.name,
		pageTitle: branding.page_title ?? cfg.user.name,
		logoUrl: logoCid ? `cid:${logoCid}` : undefined,
		primaryColor,
		onPrimary: onColor(primaryColor)
	};
}
