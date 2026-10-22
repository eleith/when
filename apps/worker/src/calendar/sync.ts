import { deleteAppointmentFromCalendar, pushAppointment } from '@when/calendar';
import { findCalendar } from '@when/config';
import {
	findAppointment,
	listActiveAppointmentsForCalendarEvent,
	listOutOfSyncAppointments,
	markSynced,
	recordCalendarEventDeletion,
	recordCalendarEventReference,
	recordServiceOutcome,
	type Appointment,
	type CalendarEventReference
} from '@when/db';
import type { WorkerContext } from '../services/context.js';
import { appointmentLinks } from '../links.js';
import { appendJobLog, markCalendarFailing } from '../services/job-log.js';
import { calendarSyncDuration } from '../services/metrics.js';
import { cleanupAppointmentVideoChat } from '../services/video-chat-cleanup.js';

export async function reconcileAppointment(ctx: WorkerContext, row: Appointment): Promise<void> {
	if (row.status === 'purged') return;
	const target =
		row.external_calendar_id ?? ctx.config.meetings[row.event_type_id]?.booking_calendar ?? null;
	const calendar = target ? findCalendar(ctx.config, target) : undefined;
	const stopTimer = calendarSyncDuration.startTimer({ provider_type: calendar?.type ?? 'unknown' });
	try {
		if (row.status === 'confirmed') {
			await publishCalendarContent(ctx, row, target);
		} else if (
			row.status === 'cancelled' ||
			row.status === 'declined' ||
			row.status === 'expired'
		) {
			await removeCalendarEvent(ctx, row);
		} else {
			// Pending and rescheduled occurrences keep their inherited event.
			await acknowledgeCalendarContent(ctx, row);
		}
	} finally {
		stopTimer();
	}
}

async function publishCalendarContent(
	ctx: WorkerContext,
	row: Appointment,
	target: string | null
): Promise<void> {
	if (!target) {
		await acknowledgeCalendarContent(ctx, row);
		return;
	}
	const cancelUrl = appointmentLinks({ baseUrl: ctx.config.url.app, appointment: row }).booked;
	const pushed = await pushAppointment(ctx.config, row, target, { cancelUrl });
	if (!pushed.ok) {
		await recordCalendarFailure(ctx, row, target, pushed.reason);
		return;
	}
	if (pushed.externalCalendarId && pushed.externalEventId) {
		const reference = { calendarId: pushed.externalCalendarId, eventId: pushed.externalEventId };
		await recordCalendarEventReference(ctx.db, row.id, reference);
		await markSynced(ctx.db, row.id, row.calendar_revision, reference);
	}
	await recordCalendarSuccess(ctx, row.id, target);
}

async function removeCalendarEvent(ctx: WorkerContext, row: Appointment): Promise<void> {
	if (!row.external_calendar_id || !row.external_event_id) {
		await acknowledgeCalendarContent(ctx, row);
		return;
	}
	const reference = { calendarId: row.external_calendar_id, eventId: row.external_event_id };
	const allowed = await canDeleteCalendarEvent(ctx, row, reference);
	if (!allowed) return;
	const deleted = await deleteAppointmentFromCalendar(
		ctx.config,
		reference.calendarId,
		reference.eventId
	);
	if (!deleted.ok) {
		await recordCalendarFailure(ctx, row, reference.calendarId, deleted.reason);
		return;
	}
	await recordCalendarEventDeletion(ctx.db, row.id, row.calendar_revision, reference);
	await recordCalendarSuccess(ctx, row.id, reference.calendarId);
}

async function canDeleteCalendarEvent(
	ctx: WorkerContext,
	row: Appointment,
	reference: CalendarEventReference
): Promise<boolean> {
	const current = await findAppointment(ctx.db, row.id);
	if (
		!current ||
		current.status !== row.status ||
		current.calendar_revision !== row.calendar_revision ||
		current.external_calendar_id !== reference.calendarId ||
		current.external_event_id !== reference.eventId
	)
		return false;
	const active = await listActiveAppointmentsForCalendarEvent(ctx.db, reference);
	return !active.some((appointment) => appointment.id !== row.id);
}

async function acknowledgeCalendarContent(ctx: WorkerContext, row: Appointment): Promise<void> {
	await markSynced(ctx.db, row.id, row.calendar_revision, {
		calendarId: row.external_calendar_id,
		eventId: row.external_event_id
	});
}

async function recordCalendarSuccess(
	ctx: WorkerContext,
	appointmentId: string,
	calendarName: string
): Promise<void> {
	await appendJobLog(ctx.db, appointmentId, 'calendar', 'done', Temporal.Now.instant().toString());
	await recordCalendarOutcome(ctx, calendarName, null);
}

async function recordCalendarFailure(
	ctx: WorkerContext,
	row: Appointment,
	calendarName: string,
	reason: string | undefined
): Promise<void> {
	await markCalendarFailing(ctx.db, row, Temporal.Now.instant().toString());
	await recordCalendarOutcome(ctx, calendarName, reason);
	ctx.logger.error({ appointmentId: row.id, reason }, 'calendar sync failed; will retry next scan');
}

async function recordCalendarOutcome(
	ctx: WorkerContext,
	calendarName: string,
	error: string | null | undefined
): Promise<void> {
	const at = Temporal.Now.instant().toString();
	await recordServiceOutcome(
		ctx.db,
		{ kind: 'calendar', name: calendarName },
		{ at, via: 'push', error }
	);
	const provider = findCalendar(ctx.config, calendarName)?.providerName;
	if (provider) {
		await recordServiceOutcome(
			ctx.db,
			{ kind: 'provider', name: provider },
			{ at, via: 'push', error }
		);
	}
}

export async function scanOnce(ctx: WorkerContext): Promise<void> {
	const rows = await listOutOfSyncAppointments(ctx.db);
	for (const row of rows) {
		const cleaned = await cleanupAppointmentVideoChat(ctx, row.id);
		if (!cleaned) continue;
		const current = await findAppointment(ctx.db, row.id);
		if (current && current.status !== 'purged') {
			await reconcileAppointment(ctx, current);
		}
	}
}
