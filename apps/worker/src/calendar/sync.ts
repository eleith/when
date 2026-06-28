import { deleteAppointmentFromCalendar, pushAppointment, type FetchFn } from '@when/calendar';
import { Temporal } from '@js-temporal/polyfill';
import { listOutOfSyncAppointments, markSynced, type Appointment } from '@when/db';
import type { WorkerContext } from '../services/context.js';
import { appointmentLinks } from '../links.js';
import { appendJobLog, markCalendarFailing } from '../services/job-log.js';
import { calendarSyncDuration } from '../services/metrics.js';

export interface SyncOptions {
	fetchImpl?: FetchFn;
}

export async function reconcileAppointment(
	ctx: WorkerContext,
	row: Appointment,
	opts: SyncOptions = {}
): Promise<void> {
	const eventType = ctx.config.event_types.find((e) => e.id === row.event_type_id);
	const targetId = row.external_calendar_id ?? eventType?.destination_calendar ?? null;
	const calendarConfig = ctx.config.calendars.find((c) => c.id === targetId);
	const providerType = calendarConfig?.type ?? 'unknown';
	const timer = calendarSyncDuration.startTimer({ provider_type: providerType });

	try {
		const revision = row.calendar_revision;
		const shouldExist = row.status === 'confirmed';

		if (shouldExist) {
			const target = row.external_calendar_id ?? eventType?.destination_calendar ?? null;
			if (!target) {
				await markSynced(ctx.db, row.id, revision);
				return;
			}
			const cancelUrl = appointmentLinks({
				baseUrl: ctx.config.url.app,
				appointment: row
			}).booked;
			const pushed = await pushAppointment(ctx.config, row, target, {
				cancelUrl,
				fetchImpl: opts.fetchImpl
			});
			if (pushed.ok) {
				await markSynced(ctx.db, row.id, revision, {
					external_event_id: pushed.externalEventId,
					external_calendar_id: pushed.externalCalendarId
				});
				await appendJobLog(ctx.db, row.id, 'calendar', 'done', Temporal.Now.instant().toString());
			} else {
				await markCalendarFailing(ctx.db, row, Temporal.Now.instant().toString());
				ctx.logger.error(
					{
						appointmentId: row.id,
						reason: pushed.reason
					},
					'calendar sync failed; will retry next scan'
				);
			}
			return;
		}

		// `pending` and `rescheduled` keep their inherited event; only these remove it.
		const shouldRemove =
			row.status === 'cancelled' || row.status === 'declined' || row.status === 'expired';
		if (shouldRemove && row.external_event_id && row.external_calendar_id) {
			const deleted = await deleteAppointmentFromCalendar(
				ctx.config,
				row.external_calendar_id,
				row.external_event_id,
				{ fetchImpl: opts.fetchImpl }
			);
			if (deleted.ok) {
				await markSynced(ctx.db, row.id, revision, {
					external_event_id: null,
					external_calendar_id: null
				});
				await appendJobLog(ctx.db, row.id, 'calendar', 'done', Temporal.Now.instant().toString());
			} else {
				await markCalendarFailing(ctx.db, row, Temporal.Now.instant().toString());
				ctx.logger.error(
					{
						appointmentId: row.id,
						reason: deleted.reason
					},
					'calendar delete failed; will retry next scan'
				);
			}
			return;
		}

		await markSynced(ctx.db, row.id, revision);
	} finally {
		timer();
	}
}

export async function scanOnce(ctx: WorkerContext, opts: SyncOptions = {}): Promise<void> {
	for (const row of await listOutOfSyncAppointments(ctx.db)) {
		await reconcileAppointment(ctx, row, opts);
	}
}
