import type { ServiceStatus } from '@when/db';
import type { WhenConfiguration } from '@when/config';

const STALE_GRACE_MINUTES = 30;
const STARTUP_GRACE_MINUTES = 15;

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
			const reason = s.last_ok_at ? s.error : `Never synced: ${s.error}`;
			return { id, health: 'bad', reason, since: s.failing_since };
		}

		if (s.last_ok_at) {
			const intervalMinutes =
				config.calendars.find((c) => c.name === id)?.sync.refresh_every_minutes ?? 10;
			const staleAfter = Temporal.Instant.from(s.last_ok_at).add({
				minutes: intervalMinutes + STALE_GRACE_MINUTES
			});
			if (Temporal.Instant.compare(now, staleAfter) > 0) {
				return {
					id,
					health: 'bad',
					reason: `No successful refresh since ${s.last_ok_at}.`,
					since: s.last_ok_at
				};
			}
			return { id, health: 'good', reason: null, since: null };
		}

		if (s.last_attempt_at) {
			const graceAfter = Temporal.Instant.from(s.last_attempt_at).add({
				minutes: STARTUP_GRACE_MINUTES
			});
			if (Temporal.Instant.compare(now, graceAfter) > 0) {
				return { id, health: 'bad', reason: 'Never synced.', since: s.last_attempt_at };
			}
		}

		return { id, health: 'unknown', reason: null, since: null };
	});
}
