import { lastCalendarRefreshAt, type ServiceStatus } from '@when/db';
import { findCalendar, type WhenConfiguration } from '@when/config';

const STALE_GRACE_MINUTES = 30;

export interface ComputedCalendarStatus {
	id: string;
	health: 'good' | 'bad' | 'unknown';
	reason: string | null;
	since: string | null;
}

export function evaluateCalendarStatuses(
	syncStatus: ServiceStatus[],
	config: WhenConfiguration,
	now: Temporal.Instant
): ComputedCalendarStatus[] {
	return syncStatus.map((s) => {
		const id = s.name;

		if (s.error) {
			return { id, health: 'bad', reason: s.error, since: s.failing_since };
		}

		const lastRefreshAt = lastCalendarRefreshAt(s);
		if (lastRefreshAt) {
			const intervalMinutes = findCalendar(config, id)?.calendar.sync.refresh_every_minutes ?? 10;
			const staleAfter = Temporal.Instant.from(lastRefreshAt).add({
				minutes: intervalMinutes + STALE_GRACE_MINUTES
			});
			if (Temporal.Instant.compare(now, staleAfter) > 0) {
				return {
					id,
					health: 'bad',
					reason: `No successful refresh since ${lastRefreshAt}.`,
					since: lastRefreshAt
				};
			}
			return { id, health: 'good', reason: null, since: null };
		}

		return { id, health: 'unknown', reason: null, since: null };
	});
}
