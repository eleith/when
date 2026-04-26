import type { WhenConfiguration } from '../config/schema';
import type { Appointment } from '../db';
import { buildIcs } from '../ics';
import { logger } from '../logger';
import { deleteCalDavEvent, putCalDavEvent, type FetchFn } from './caldav';

export type PushResult =
	| { ok: true; externalEventId: string; externalCalendarId: string }
	| { ok: false; reason: string };

export type DeleteResult = { ok: true } | { ok: false; reason: string };

export interface PushOptions {
	cancelUrl: string;
	fetchImpl?: FetchFn;
}

/**
 * Create or update the appointment in its destination calendar. CalDAV
 * only — non-CalDAV calendars are reported as a deferred no-op (caller
 * should treat as failure-to-push for notification_status).
 */
export async function pushAppointment(
	cfg: WhenConfiguration,
	appointment: Appointment,
	destinationCalendarId: string,
	opts: PushOptions
): Promise<PushResult> {
	const cal = cfg.calendars.find((c) => c.id === destinationCalendarId);
	if (!cal) return { ok: false, reason: `unknown destination calendar "${destinationCalendarId}"` };
	if (cal.type !== 'caldav') {
		return { ok: false, reason: `${cal.type} push is deferred; only CalDAV is supported` };
	}

	const eventType = cfg.event_types.find((e) => e.id === appointment.event_type_id);
	const ics = buildIcs({
		appointment,
		eventTypeName: eventType?.name ?? appointment.event_type_id,
		organizerName: cfg.user.name,
		organizerEmail: cfg.user.email,
		cancelUrl: opts.cancelUrl
	});

	try {
		await putCalDavEvent(
			{ url: cal.url, username: cal.username, password: cal.password },
			appointment.id,
			ics,
			{ fetchImpl: opts.fetchImpl }
		);
		return { ok: true, externalEventId: appointment.id, externalCalendarId: cal.id };
	} catch (err) {
		logger.error({ err, calendarId: cal.id, appointmentId: appointment.id }, 'CalDAV push failed');
		return { ok: false, reason: String(err) };
	}
}

/**
 * Delete the appointment from its destination calendar. Treats 404 as
 * success (the event was already gone).
 */
export async function deleteAppointmentFromCalendar(
	cfg: WhenConfiguration,
	externalCalendarId: string,
	externalEventId: string,
	opts: { fetchImpl?: FetchFn } = {}
): Promise<DeleteResult> {
	const cal = cfg.calendars.find((c) => c.id === externalCalendarId);
	if (!cal) return { ok: false, reason: `unknown calendar "${externalCalendarId}"` };
	if (cal.type !== 'caldav') {
		return { ok: false, reason: `${cal.type} delete is deferred; only CalDAV is supported` };
	}

	try {
		await deleteCalDavEvent(
			{ url: cal.url, username: cal.username, password: cal.password },
			externalEventId,
			{ fetchImpl: opts.fetchImpl }
		);
		return { ok: true };
	} catch (err) {
		logger.error({ err, calendarId: cal.id, externalEventId }, 'CalDAV delete failed');
		return { ok: false, reason: String(err) };
	}
}
