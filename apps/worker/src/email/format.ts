import { parseGuestAnswers, type Meeting, type WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';
import type { DetailRow } from './content.js';
import type { AppointmentEmailInput } from './types.js';

export function eventTypeName(
	eventType: Meeting | undefined,
	appointment: Pick<Appointment, 'event_type_id'>
): string {
	return eventType?.title ?? appointment.event_type_id;
}

export function guestLabel(a: Pick<Appointment, 'guest_name' | 'guest_email'>): string {
	return a.guest_email ? `${a.guest_name} <${a.guest_email}>` : a.guest_name;
}

export function answerRows(a: Pick<Appointment, 'guest_answers'>): DetailRow[] {
	return parseGuestAnswers(a.guest_answers).map((ans) => ({
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

export function fmtInstant(at: string, tz: string): string {
	try {
		const z = Temporal.Instant.from(at).toZonedDateTimeISO(tz);
		const date = z.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
		const time = z.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
		return `${date}, ${time} (${tzShort(tz, at)})`;
	} catch {
		return at;
	}
}

export function whenForGuest(i: AppointmentEmailInput): string {
	const a = i.appointment;
	return fmtWhen(a.start_time, a.end_time, a.guest_timezone ?? i.cfg.user.timezone);
}

export function whenForHost(i: AppointmentEmailInput): string {
	const a = i.appointment;
	return fmtWhen(a.start_time, a.end_time, i.cfg.user.timezone);
}

export interface Brand {
	name: string;
	pageTitle: string;
	appUrl: string;
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
	const appearance = cfg.user.appearance;
	const primaryColor = appearance.primary_light_color;
	return {
		name: cfg.user.name,
		pageTitle: appearance.title,
		appUrl: cfg.url.app,
		logoUrl: logoCid ? `cid:${logoCid}` : undefined,
		primaryColor,
		onPrimary: onColor(primaryColor)
	};
}
