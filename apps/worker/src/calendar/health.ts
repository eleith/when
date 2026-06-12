import { Temporal } from '@js-temporal/polyfill';
import {
	listCalendarSyncStatus,
	listPublishFailingAppointments,
	setCalendarHealth,
	type CalendarHealth,
	type CalendarSyncStatus
} from '@when/db';
import { getOpenWorkflow, sendOwnerAlert } from '@when/jobs';
import type { WorkerContext } from '../services/context.js';

// Surface breakage only past these windows; it clears the moment a cycle succeeds.
const READ_STALE = Temporal.Duration.from({ minutes: 60 });
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
	startedAt: Temporal.Instant
): Derived {
	if (writeFailing) {
		return {
			health: 'bad',
			reason: 'A booking has failed to sync to this calendar for over 30 minutes.'
		};
	}
	if (status.last_successful_refresh_at) {
		if (isAfter(now, Temporal.Instant.from(status.last_successful_refresh_at), READ_STALE)) {
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

	const failing = await listPublishFailingAppointments(
		ctx.db,
		now.subtract(PUBLISH_FAILING).toString()
	);
	const failingCalendars = new Set<string>();
	for (const a of failing) {
		const target =
			a.external_calendar_id ??
			ctx.config.event_types.find((e) => e.id === a.event_type_id)?.destination_calendar ??
			null;
		if (target) failingCalendars.add(target);
	}

	// A publish stuck past the threshold is no longer just "queued"; mark it failed
	// so the admin chips reflect it (a later success resets it to ok in the scan).
	if (failing.length > 0) {
		await ctx.db
			.updateTable('appointments')
			.set({ calendar_push_notification_status: 'failed' })
			.where(
				'id',
				'in',
				failing.map((a) => a.id)
			)
			.where('calendar_push_notification_status', '=', 'queued')
			.execute();
	}

	for (const status of await listCalendarSyncStatus(ctx.db)) {
		const next = deriveHealth(status, failingCalendars.has(status.calendar_id), now, startedAt);
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
