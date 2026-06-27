import { systemClock } from '$lib/server/clock';
import { getConfig, getDb } from '$lib/server/state';
import {
	countAppointments,
	listCalendarSyncStatus,
	listOutOfSyncAppointments,
	parseActionLog
} from '@when/db';
import { sql } from 'kysely';
import { Temporal } from '@js-temporal/polyfill';
import type { LayoutServerLoad } from './$types';

const STALE_GRACE_MINUTES = 30;
const PUBLISH_FAILING_MINUTES = 30;
const STARTUP_GRACE_MINUTES = 15;

function openCalendarFailureAt(actionLog: string | null, appointmentId: string): string | null {
	const last = parseActionLog(actionLog)
		.filter((e) => e.action === 'calendar' && e.payload?.metadata?.appointment_id === appointmentId)
		.at(-1);
	return last?.payload?.metadata?.state === 'failed' ? last.at : null;
}

export const load: LayoutServerLoad = async () => {
	const db = getDb();
	const config = getConfig();
	const now = systemClock.now();
	const nowIso = now.toISOString();
	const nowTemporal = Temporal.Now.instant();

	const [pendingCount, upcomingCount, syncStatus, outOfSyncAppts, conflictResult] =
		await Promise.all([
			countAppointments(db, { bucket: 'pending', now }),
			countAppointments(db, { bucket: 'upcoming', now }),
			listCalendarSyncStatus(db),
			listOutOfSyncAppointments(db),
			db
				.selectFrom('appointments')
				.select(sql<number>`count(*)`.as('cnt'))
				.where('status', '=', 'confirmed')
				.where('end_time', '>', nowIso)
				.where('has_possible_conflict', '=', 1)
				.executeTakeFirst()
		]);

	const conflictCount = Number(conflictResult?.cnt ?? 0);

	// Map out-of-sync appointments to target calendars that are failing
	const failingCalendarIds = new Map<string, { failedAt: string }>();
	const cutoff = nowTemporal.subtract({ minutes: PUBLISH_FAILING_MINUTES }).toString();
	for (const a of outOfSyncAppts) {
		const failedAt = openCalendarFailureAt(a.action_log, a.id);
		if (failedAt !== null && failedAt < cutoff) {
			const target =
				a.external_calendar_id ??
				config.event_types.find((e) => e.id === a.event_type_id)?.destination_calendar ??
				null;
			if (target) {
				failingCalendarIds.set(target, { failedAt });
			}
		}
	}

	const calendars = syncStatus.map((s) => {
		const intervalMinutes =
			config.calendars.find((c) => c.id === s.calendar_id)?.sync?.refresh_interval ?? 10;

		let health: 'good' | 'bad' | 'unknown' = 'unknown';
		let reason: string | null = null;
		let since: string | null = null;

		const writeFailure = failingCalendarIds.get(s.calendar_id);
		if (writeFailure) {
			health = 'bad';
			reason = 'An appointment has failed to sync to this calendar for over 30 minutes.';
			since = writeFailure.failedAt;
		} else if (s.last_successful_refresh_at) {
			const staleAfter = Temporal.Instant.from(s.last_successful_refresh_at).add({
				minutes: intervalMinutes + STALE_GRACE_MINUTES
			});
			if (Temporal.Instant.compare(nowTemporal, staleAfter) > 0) {
				health = 'bad';
				reason = `No successful refresh since ${s.last_successful_refresh_at}.`;
				since = s.last_successful_refresh_at;
			} else {
				health = 'good';
			}
		} else if (s.last_refresh_at) {
			const graceAfter = Temporal.Instant.from(s.last_refresh_at).add({
				minutes: STARTUP_GRACE_MINUTES
			});
			if (Temporal.Instant.compare(nowTemporal, graceAfter) > 0) {
				health = 'bad';
				reason = s.error ? `Never synced: ${s.error}` : 'Never synced.';
				since = s.last_refresh_at;
			}
		}

		return {
			id: s.calendar_id,
			health,
			reason,
			since
		};
	});

	return {
		pendingCount,
		upcomingCount,
		conflictCount,
		calendars
	};
};
