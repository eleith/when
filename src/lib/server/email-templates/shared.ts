import { Temporal } from '@js-temporal/polyfill';
import type { NotifyContext } from '../notify';
import { escapeHtml } from './escape';
import type { BrandContext } from './layout';

export function deriveBrand(ctx: NotifyContext): BrandContext {
	const raw = ctx.cfg.user.branding?.primary_color;
	const primaryColor = typeof raw === 'string' ? raw : raw?.light;
	return { name: ctx.cfg.user.name, primaryColor };
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
		const date = s.toLocaleString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
		const time = (z: Temporal.ZonedDateTime) =>
			z.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
		return `${date}, ${time(s)} – ${time(e)} (${tzShort(tz, start)})`;
	} catch {
		return `${start} – ${end}`;
	}
}

export function heading(text: string): string {
	return `<h2 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#1a1a1a;">${escapeHtml(text)}</h2>`;
}

export function paragraph(text: string): string {
	return `<p style="margin:0 0 16px;">${escapeHtml(text)}</p>`;
}

export interface DetailRow {
	label: string;
	value: string | null | undefined;
}

export function detailsList(rows: DetailRow[]): string {
	const cells = rows
		.filter((r): r is { label: string; value: string } => !!r.value)
		.map(
			(r) =>
				`<tr><td style="padding:4px 16px 4px 0;color:#6b7280;font-weight:600;white-space:nowrap;vertical-align:top;">${escapeHtml(r.label)}</td><td style="padding:4px 0;vertical-align:top;">${escapeHtml(r.value)}</td></tr>`
		)
		.join('');
	if (!cells) return '';
	return `<table style="border-collapse:collapse;margin:8px 0 24px;font-size:14px;">${cells}</table>`;
}

export interface ActionLink {
	href: string;
	label: string;
	kind?: 'primary' | 'secondary' | 'danger';
}

function renderLink(action: ActionLink, primaryColor: string): string {
	const href = escapeHtml(action.href);
	const label = escapeHtml(action.label);
	if (action.kind === 'primary') {
		return `<a href="${href}" style="display:inline-block;padding:10px 20px;background:${escapeHtml(primaryColor)};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;margin:0 8px 8px 0;">${label}</a>`;
	}
	if (action.kind === 'danger') {
		return `<a href="${href}" style="display:inline-block;padding:10px 18px;border:1px solid #fecaca;border-radius:6px;color:#b91c1c;text-decoration:none;margin:0 8px 8px 0;">${label}</a>`;
	}
	return `<a href="${href}" style="display:inline-block;padding:10px 18px;border:1px solid #d1d5db;border-radius:6px;color:#1a1a1a;text-decoration:none;margin:0 8px 8px 0;">${label}</a>`;
}

export function actionRow(actions: ActionLink[], primaryColor: string): string {
	if (actions.length === 0) return '';
	const links = actions.map((a) => renderLink(a, primaryColor)).join('');
	return `<p style="margin:24px 0 0;line-height:1.8;">${links}</p>`;
}

export function viewBookingFooter(bookedUrl: string | undefined): string | undefined {
	if (!bookedUrl) return undefined;
	return `<a href="${escapeHtml(bookedUrl)}" style="color:#6b7280;">View this booking</a>`;
}

export function eventTypeName(ctx: NotifyContext): string {
	return ctx.eventType?.name ?? ctx.appointment.event_type_id;
}

/** Joins plaintext lines, dropping nullish/false entries but preserving empty strings as blank lines. */
export function lines(...parts: (string | false | null | undefined)[]): string {
	return parts.filter((p) => p !== null && p !== undefined && p !== false).join('\n');
}
