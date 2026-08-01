import type { Kysely } from 'kysely';
import type { Calendar, WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';
import { connectServices, fetchBusyIntervals } from '@when/calendar';
import { listCalendarSyncStatus, listOutOfSyncAppointments } from '@when/db';
import { evaluateCalendarStatuses } from './health';

const WINDOW_DAYS = 14;
const DEFAULT_REFRESH_MINUTES = 10;

export interface CalendarView {
	name: string;
	type: 'google' | 'caldav';
	service: string;
	target: { label: string; value: string };
	refreshEveryMinutes: number;
	health: 'good' | 'bad' | 'unknown';
	reason: string | null;
	lastSyncedAt: string | null;
}

export type CalendarProbeResult = { ok: true; message: string } | { ok: false; message: string };

// Cheap: config plus two indexed reads. The worker records a verdict on every refresh
// pass, so the page reports real health without reaching a provider.
export async function listCalendars(
	config: WhenConfiguration,
	db: Kysely<Database>
): Promise<CalendarView[]> {
	const [syncStatus, outOfSync] = await Promise.all([
		listCalendarSyncStatus(db),
		listOutOfSyncAppointments(db)
	]);

	const computed = evaluateCalendarStatuses(syncStatus, outOfSync, config, Temporal.Now.instant());
	const statuses = new Map(computed.map((s) => [s.id, s]));
	const lastSynced = new Map(syncStatus.map((s) => [s.calendar_id, s.last_successful_refresh_at]));

	return config.calendars.map((cal) => {
		const status = statuses.get(cal.name);
		return {
			name: cal.name,
			type: cal.type,
			service: cal.provider,
			target: targetOf(cal),
			refreshEveryMinutes: cal.sync?.refresh_every_minutes ?? DEFAULT_REFRESH_MINUTES,
			health: status?.health ?? 'unknown',
			reason: status?.reason ?? null,
			lastSyncedAt: lastSynced.get(cal.name) ?? null
		};
	});
}

// Which config field points this calendar at the provider, and what it holds.
function targetOf(cal: Calendar): CalendarView['target'] {
	if ('google_calendar_id' in cal) {
		return { label: 'google_calendar_id', value: cal.google_calendar_id };
	}
	if ('path' in cal) return { label: 'path', value: cal.path };
	return { label: 'url', value: cal.url };
}

export async function probeCalendar(
	config: WhenConfiguration,
	db: Kysely<Database>,
	name: string
): Promise<CalendarProbeResult> {
	const cal = config.calendars.find((c) => c.name === name);
	if (!cal) return { ok: false, message: `No calendar named "${name}".` };

	try {
		const now = Temporal.Now.instant();
		const window = { start: now, end: now.add({ hours: 24 * WINDOW_DAYS }) };
		const services = await connectServices(config.providers ?? [], db);
		const busy = await fetchBusyIntervals(cal, window, { services });

		const label = busy.length === 1 ? 'busy interval' : 'busy intervals';
		return { ok: true, message: `${busy.length} ${label} over the next ${WINDOW_DAYS} days.` };
	} catch (err) {
		return { ok: false, message: err instanceof Error ? err.message : String(err) };
	}
}
