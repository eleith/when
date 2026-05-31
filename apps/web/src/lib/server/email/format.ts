import { Temporal } from '@js-temporal/polyfill';
import type { EventType, WhenConfiguration } from '../config/schema';
import type { Appointment } from '../db';

export function eventTypeName(
	eventType: EventType | undefined,
	appointment: Pick<Appointment, 'event_type_id'>
): string {
	return eventType?.name ?? appointment.event_type_id;
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

export interface Brand {
	name: string;
	primaryColor?: string;
}

export function deriveBrand(cfg: WhenConfiguration): Brand {
	const raw = cfg.user.branding?.primary_color;
	const primaryColor = typeof raw === 'string' ? raw : raw?.light;
	return { name: cfg.user.name, primaryColor };
}
