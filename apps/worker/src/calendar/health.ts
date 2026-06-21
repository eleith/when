import { Temporal } from '@js-temporal/polyfill';
import {
	listCalendarSyncStatus,
	listOutOfSyncAppointments,
	setCalendarHealth,
	type CalendarHealth,
	type CalendarSyncStatus
} from '@when/db';
import { getOpenWorkflow, sendOwnerAlert } from '@when/jobs';
import type { WorkerContext } from '../services/context.js';
import { openCalendarQueuedAt } from '../services/job-log.js';
import { DEFAULT_REFRESH_INTERVAL_MINUTES } from './intervals.js';

// Surface breakage only past these windows; it clears the moment a cycle succeeds.
// Read staleness is relative to each calendar's own refresh interval (+ grace), so
// a healthy slow calendar isn't flagged just for refreshing infrequently.
const STALE_GRACE_MINUTES = 30;
const PUBLISH_FAILING = Temporal.Duration.from({ minutes: 30 });
// A never-synced calendar stays `unknown` this long after boot before it can go
// `bad`, so a normal startup doesn't false-alarm.
const STARTUP_GRACE = Temporal.Duration.from({ minutes: 15 });

// Process start (module load ≈ boot), the reference for the never-synced grace.
const WORKER_STARTED_AT = Temporal.Now.instant();

export interface HealthEvalOptions {
	now?: Temporal.Instant;
	startedAt?: Temporal.Instant;
}

interface Derived {
	health: CalendarHealth;
	reason: string | null;
}

function isAfter(now: Temporal.Instant, then: Temporal.Instant, by: Temporal.Duration): boolean {
	return Temporal.Instant.compare(now, then.add(by)) > 0;
}

function deriveHealth(
	status: CalendarSyncStatus,
	writeFailing: boolean,
	now: Temporal.Instant,
	startedAt: Temporal.Instant,
	intervalMinutes: number
): Derived {
	if (writeFailing) {
		return {
			health: 'bad',
			reason: 'An appointment has failed to sync to this calendar for over 30 minutes.'
		};
	}
	if (status.last_successful_refresh_at) {
		const staleAfter = Temporal.Duration.from({ minutes: intervalMinutes + STALE_GRACE_MINUTES });
		if (isAfter(now, Temporal.Instant.from(status.last_successful_refresh_at), staleAfter)) {
			return {
				health: 'bad',
				reason: `No successful refresh since ${status.last_successful_refresh_at}.`
			};
		}
		return { health: 'good', reason: null };
	}
	// Never synced: stay `unknown` through the startup grace; only `bad` once it has
	// actually attempted (and failed) and we've been up long enough to mean it.
	if (status.last_refresh_at && isAfter(now, startedAt, STARTUP_GRACE)) {
		return {
			health: 'bad',
			reason: status.error ? `Never synced: ${status.error}` : 'Never synced.'
		};
	}
	return { health: 'unknown', reason: null };
}

export async function evaluateHealth(
	ctx: WorkerContext,
	opts: HealthEvalOptions = {}
): Promise<void> {
	const now = opts.now ?? Temporal.Now.instant();
	const startedAt = opts.startedAt ?? WORKER_STARTED_AT;

	// Failing = an open calendar `queued` unanswered past the threshold.
	const cutoff = now.subtract(PUBLISH_FAILING).toString();
	const failing = (await listOutOfSyncAppointments(ctx.db)).filter((a) => {
		const queuedAt = openCalendarQueuedAt(a.action_log, a.id);
		return queuedAt !== null && queuedAt < cutoff;
	});
	const failingCalendars = new Set<string>();
	for (const a of failing) {
		const target =
			a.external_calendar_id ??
			ctx.config.event_types.find((e) => e.id === a.event_type_id)?.destination_calendar ??
			null;
		if (target) failingCalendars.add(target);
	}

	const statuses = await listCalendarSyncStatus(ctx.db);
	for (const status of statuses) {
		const interval =
			ctx.config.calendars.find((c) => c.id === status.calendar_id)?.sync?.refresh_interval ??
			DEFAULT_REFRESH_INTERVAL_MINUTES;
		const next = deriveHealth(
			status,
			failingCalendars.has(status.calendar_id),
			now,
			startedAt,
			interval
		);
		if (next.health === status.health) continue;

		// Enqueue the alert (a durable job) BEFORE flipping, so a crash in between
		// re-fires at most one duplicate rather than losing the alert.
		await alertOnEdge(status, next, now);
		await setCalendarHealth(ctx.db, status.calendar_id, {
			health: next.health,
			changedAt: now.toString(),
			reason: next.reason
		});
	}
}

async function alertOnEdge(
	status: CalendarSyncStatus,
	next: Derived,
	now: Temporal.Instant
): Promise<void> {
	const broke = next.health === 'bad' && status.health !== 'bad';
	const recovered = next.health === 'good' && status.health === 'bad';
	if (!broke && !recovered) return;

	const kind = broke ? 'broke' : 'recovered';
	await getOpenWorkflow().runWorkflow(
		sendOwnerAlert,
		{
			calendarId: status.calendar_id,
			kind,
			since: broke ? status.last_successful_refresh_at : null,
			reason: next.reason ?? 'A refresh just succeeded.'
		},
		{ idempotencyKey: `owner-alert:${status.calendar_id}:${kind}:${now.toString()}` }
	);
}
