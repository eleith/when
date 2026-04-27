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
			const ics = buildIcs({
				appointment,
				eventTypeName,
				organizerName: cfg.user.name,
				organizerEmail: cfg.user.email,
				cancelUrl: opts.cancelUrl
			});

			await putCalDavEvent(
				{ url: cal.url, username: cal.username, password: cal.password },
				appointment.id,
				ics,
				{ fetchImpl: opts.fetchImpl }
			);
			return { ok: true, externalEventId: appointment.id, externalCalendarId: cal.id };
		} else if (cal.type === 'google') {
			const result = await putGoogleEvent(cal as GoogleCalendar, appointment, {
				cancelUrl: opts.cancelUrl,
				eventTypeName,
				organizerName: cfg.user.name,
				fetchImpl: opts.fetchImpl
			});
			return { ok: true, externalEventId: result.externalEventId, externalCalendarId: cal.id };
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
			await deleteCalDavEvent(
				{ url: cal.url, username: cal.username, password: cal.password },
				externalEventId,
				{ fetchImpl: opts.fetchImpl }
			);
		} else if (cal.type === 'google') {
			await deleteGoogleEvent(cal as GoogleCalendar, externalEventId, {
				fetchImpl: opts.fetchImpl
			});
		} else {
			return { ok: false, reason: `unsupported calendar type` };
		}
		return { ok: true };
	} catch (err) {
		logger.error({ err, calendarId: cal.id, externalEventId }, `${cal.type} delete failed`);
		return { ok: false, reason: String(err) };
	}
}
