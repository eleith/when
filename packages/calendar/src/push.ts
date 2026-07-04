import type { WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';
import { logger } from './logger.js';
import type { FetchFn } from './adapters/caldav.js';
import {
	getCalendarAdapter,
	type PushOptions,
	type PushResult,
	type DeleteResult
} from './adapter.js';

export type { PushOptions, PushResult, DeleteResult };

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
		const adapter = getCalendarAdapter(cal, cfg);
		return await adapter.pushAppointment(cfg, appointment, eventTypeName, opts);
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
		const adapter = getCalendarAdapter(cal, cfg);
		return await adapter.deleteAppointment(externalEventId, { fetchImpl: opts.fetchImpl });
	} catch (err) {
		logger.error({ err, calendarId: cal.id, externalEventId }, `${cal.type} delete failed`);
		return { ok: false, reason: String(err) };
	}
}
