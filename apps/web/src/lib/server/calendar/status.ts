import type { Kysely } from 'kysely';
import type { Calendar, WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';
import { getOpenWorkflow, testCalendar } from '@when/jobs';
import { workerReachable } from '$lib/server/worker';
import { listServiceStatus, listOutOfSyncAppointments } from '@when/db';
import { evaluateCalendarStatuses } from './health';

const PROBE_TIMEOUT_MS = 30_000;
const DEFAULT_REFRESH_MINUTES = 10;

export interface CalendarView {
	name: string;
	type: 'google' | 'caldav';
	provider: string;
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
		listServiceStatus(db, 'calendar'),
		listOutOfSyncAppointments(db)
	]);

	const computed = evaluateCalendarStatuses(syncStatus, outOfSync, config, Temporal.Now.instant());
	const statuses = new Map(computed.map((s) => [s.id, s]));
	const lastSynced = new Map(syncStatus.map((s) => [s.name, s.last_ok_at]));

	return config.calendars.map((cal) => {
		const status = statuses.get(cal.name);
		return {
			name: cal.name,
			type: cal.type,
			provider: cal.provider,
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
	name: string
): Promise<CalendarProbeResult> {
	if (!(await workerReachable(config.url.worker))) {
		return { ok: false, message: 'The worker is not reachable, so nothing would check it.' };
	}

	try {
		const handle = await getOpenWorkflow().runWorkflow(
			testCalendar,
			{ name },
			{ idempotencyKey: crypto.randomUUID() }
		);
		const { busyCount, days } = await handle.result({ timeoutMs: PROBE_TIMEOUT_MS });
		const label = busyCount === 1 ? 'busy interval' : 'busy intervals';
		return { ok: true, message: `${busyCount} ${label} over the next ${days} days.` };
	} catch (err) {
		return { ok: false, message: err instanceof Error ? err.message : String(err) };
	}
}
