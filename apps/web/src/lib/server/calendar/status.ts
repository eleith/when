import type { Kysely } from 'kysely';
import type { Calendar, WhenConfiguration } from '@when/config';
import type { Database } from '@when/db';
import { getOpenWorkflow, testCalendar } from '@when/jobs';
import { workerReachable } from '$lib/server/worker';
import { listServiceStatus } from '@when/db';
import { evaluateCalendarStatuses } from './health';

const PROBE_TIMEOUT_MS = 30_000;

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
	const syncStatus = await listServiceStatus(db, 'calendar');

	const computed = evaluateCalendarStatuses(syncStatus, config, Temporal.Now.instant());
	const statuses = new Map(computed.map((s) => [s.id, s]));
	const lastSynced = new Map(syncStatus.map((s) => [s.name, s.last_ok_at]));

	return config.calendars.map((cal) => {
		const status = statuses.get(cal.name);
		return {
			name: cal.name,
			type: cal.type,
			provider: cal.provider,
			target: targetOf(cal),
			refreshEveryMinutes: cal.sync.refresh_every_minutes,
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
	const reachable = await workerReachable(config.url.worker);
	if (!reachable) {
		return { ok: false, message: 'Worker not reachable.' };
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
