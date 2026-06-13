import { Temporal } from '@js-temporal/polyfill';
import type { EventType, WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';

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

const DEFAULT_PRIMARY_COLOR = '#2563eb';

export interface Brand {
	name: string;
	/** Header image: `branding.logo_url` (or `avatar_url`), absolute so mail clients can load it. */
	logoUrl?: string;
	/** `branding.primary_color` (light), or the default. Drives strip/buttons/links. */
	primaryColor: string;
}

// Mail clients can't resolve relative URLs (no page origin), so resolve any
// configured image against the public app base. Absolute URLs pass through.
function toAbsoluteUrl(url: string | undefined, base: string): string | undefined {
	if (!url) return undefined;
	try {
		return new URL(url, base).toString();
	} catch {
		return url;
	}
}

export function deriveBrand(cfg: WhenConfiguration): Brand {
	const branding = cfg.user.branding;
	const raw = branding?.primary_color;
	const primaryColor = (typeof raw === 'string' ? raw : raw?.light) ?? DEFAULT_PRIMARY_COLOR;
	const logoUrl = toAbsoluteUrl(branding?.logo_url ?? branding?.avatar_url, cfg.url.app);
	return { name: cfg.user.name, logoUrl, primaryColor };
}
