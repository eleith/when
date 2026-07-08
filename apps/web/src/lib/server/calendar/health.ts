import { parseActionLog, type Appointment, type CalendarSyncStatus } from '@when/db';
import type { WhenConfiguration } from '@when/config';

const STALE_GRACE_MINUTES = 30;
const PUBLISH_FAILING_MINUTES = 30;
const STARTUP_GRACE_MINUTES = 15;

export interface ComputedCalendarStatus {
	id: string;
	health: 'good' | 'bad' | 'unknown';
	reason: string | null;
	since: string | null;
}

export function openCalendarFailureAt(
	actionLog: string | null,
	appointmentId: string
): string | null {
	const last = parseActionLog(actionLog)
		.filter((e) => e.action === 'calendar' && e.payload?.metadata?.appointment_id === appointmentId)
		.at(-1);
	return last?.payload?.metadata?.state === 'failed' ? last.at : null;
}

export function evaluateCalendarStatuses(
	syncStatus: CalendarSyncStatus[],
	outOfSyncAppts: Appointment[],
	config: WhenConfiguration,
	now: Temporal.Instant
): ComputedCalendarStatus[] {
	// Map out-of-sync appointments to target calendars that are failing
	const failingCalendarIds = new Map<string, { failedAt: string }>();
	const cutoff = now.subtract({ minutes: PUBLISH_FAILING_MINUTES }).toString();
	for (const a of outOfSyncAppts) {
		const failedAt = openCalendarFailureAt(a.action_log, a.id);
		if (failedAt !== null && failedAt < cutoff) {
			const target =
				a.external_calendar_id ??
				config.meetings.find((e) => e.name === a.event_type_id)?.booking_calendar ??
				null;
			if (target) {
				failingCalendarIds.set(target, { failedAt });
			}
		}
	}

	return syncStatus.map((s) => {
		const intervalMinutes =
			config.calendars.find((c) => c.name === s.calendar_id)?.sync?.refresh_interval ?? 10;

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
			if (Temporal.Instant.compare(now, staleAfter) > 0) {
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
			if (Temporal.Instant.compare(now, graceAfter) > 0) {
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
}
