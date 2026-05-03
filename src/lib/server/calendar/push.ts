import type { WhenConfiguration, GoogleCalendar } from '../config/schema';
import type { Appointment } from '../db';
import { buildIcs } from '../ics';
import { logger } from '../logger';
import { deleteCalDavEvent, putCalDavEvent, type FetchFn } from './caldav';
import { putGoogleEvent, deleteGoogleEvent } from './google';

export type PushResult =
	| { ok: true; externalEventId: string; externalCalendarId: string }
	| { ok: false; reason: string };

export type DeleteResult = { ok: true } | { ok: false; reason: string };

export interface PushOptions {
	cancelUrl: string;
	fetchImpl?: FetchFn;
}

async function pushToCalDav(
	cfg: WhenConfiguration,
	appointment: Appointment,
	eventTypeName: string,
	calId: string,
	caldav: { url: string; username: string; password: string },
	opts: PushOptions
): Promise<PushResult> {
	const ics = buildIcs({
		appointment,
		eventTypeName,
		organizerName: cfg.user.name,
		organizerEmail: cfg.user.email,
		cancelUrl: opts.cancelUrl
	});

	await putCalDavEvent(caldav, appointment.id, ics, { fetchImpl: opts.fetchImpl });
	return { ok: true, externalEventId: appointment.id, externalCalendarId: calId };
}

async function pushToGoogle(
	cfg: WhenConfiguration,
	appointment: Appointment,
	cal: GoogleCalendar,
	eventTypeName: string,
	opts: PushOptions
): Promise<PushResult> {
	const result = await putGoogleEvent(cal, appointment, {
		cancelUrl: opts.cancelUrl,
		eventTypeName,
		organizerName: cfg.user.name,
		fetchImpl: opts.fetchImpl
	});
	return { ok: true, externalEventId: result.externalEventId, externalCalendarId: cal.id };
}

/**
 * Create or update the appointment in its destination calendar.
 */
export async function pushAppointment(
	cfg: WhenConfiguration,
	appointment: Appointment,
	destinationCalendarId: string,
	opts: PushOptions
): Promise<PushResult> {
	const cal = cfg.calendars.find((c) => c.id === destinationCalendarId);
	if (!cal) return { ok: false, reason: `unknown destination calendar "${destinationCalendarId}"` };

	const eventType = cfg.event_types.find((e) => e.id === appointment.event_type_id);
	const eventTypeName = eventType?.name ?? appointment.event_type_id;

	try {
		if (cal.type === 'caldav') {
			return await pushToCalDav(
				cfg,
				appointment,
				eventTypeName,
				cal.id,
				{ url: cal.url, username: cal.username, password: cal.password },
				opts
			);
		}
		if (cal.type === 'google') {
			return await pushToGoogle(cfg, appointment, cal as GoogleCalendar, eventTypeName, opts);
		}
		return { ok: false, reason: `unsupported calendar type` };
	} catch (err) {
		logger.error(
			{ err, calendarId: cal.id, appointmentId: appointment.id },
			`${cal.type} push failed`
		);
		return { ok: false, reason: String(err) };
	}
}

async function deleteFromCalDav(
	externalCalendarId: string,
	externalEventId: string,
	cal: { url: string; username: string; password: string },
	opts: { fetchImpl?: FetchFn }
): Promise<DeleteResult> {
	await deleteCalDavEvent(cal, externalEventId, { fetchImpl: opts.fetchImpl });
	return { ok: true };
}

async function deleteFromGoogle(
	externalEventId: string,
	cal: GoogleCalendar,
	opts: { fetchImpl?: FetchFn }
): Promise<DeleteResult> {
	await deleteGoogleEvent(cal, externalEventId, { fetchImpl: opts.fetchImpl });
	return { ok: true };
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

	try {
		if (cal.type === 'caldav') {
			return await deleteFromCalDav(externalCalendarId, externalEventId, cal, opts);
		}
		if (cal.type === 'google') {
			return await deleteFromGoogle(externalEventId, cal as GoogleCalendar, opts);
		}
		return { ok: false, reason: `unsupported calendar type` };
	} catch (err) {
		logger.error({ err, calendarId: cal.id, externalEventId }, `${cal.type} delete failed`);
		return { ok: false, reason: String(err) };
	}
}
