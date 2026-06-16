import { deleteAppointmentFromCalendar, pushAppointment, type FetchFn } from '@when/calendar';
import { Temporal } from '@js-temporal/polyfill';
import {
	listOutOfSyncAppointments,
	markSynced,
	recordPublishFailure,
	type Appointment
} from '@when/db';
import type { WorkerContext } from '../services/context.js';
import { bookingLinks } from '../links.js';

export interface SyncOptions {
	fetchImpl?: FetchFn;
}

export async function reconcileAppointment(
	ctx: WorkerContext,
	row: Appointment,
	opts: SyncOptions = {}
): Promise<void> {
	const revision = row.calendar_revision;
	const eventType = ctx.config.event_types.find((e) => e.id === row.event_type_id);
	const shouldExist = row.status === 'confirmed';

	if (shouldExist) {
		const target = row.external_calendar_id ?? eventType?.destination_calendar ?? null;
		if (!target) {
			await markSynced(ctx.db, row.id, revision);
			return;
		}
		const cancelUrl = bookingLinks({
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
				external_calendar_id: pushed.externalCalendarId,
				calendar_push_notification_status: 'ok',
				calendar_push_failing_since: null
			});
		} else {
			await recordPublishFailure(ctx.db, row.id, Temporal.Now.instant().toString());
			ctx.logger.error('calendar sync failed; will retry next scan', {
				appointmentId: row.id,
				reason: pushed.reason
			});
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
				external_calendar_id: null,
				calendar_push_notification_status: 'ok',
				calendar_push_failing_since: null
			});
		} else {
			await recordPublishFailure(ctx.db, row.id, Temporal.Now.instant().toString());
			ctx.logger.error('calendar delete failed; will retry next scan', {
				appointmentId: row.id,
				reason: deleted.reason
			});
		}
		return;
	}

	await markSynced(ctx.db, row.id, revision);
}

export async function scanOnce(ctx: WorkerContext, opts: SyncOptions = {}): Promise<void> {
	for (const row of await listOutOfSyncAppointments(ctx.db)) {
		await reconcileAppointment(ctx, row, opts);
	}
}
