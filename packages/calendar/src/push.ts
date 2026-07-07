import type { WhenConfiguration } from '@when/config';
import type { Appointment } from '@when/db';
import { logger } from './logger.js';
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
	const cal = cfg.calendars.find((c) => c.name === destinationCalendarId);
	if (!cal) return { ok: false, reason: `unknown destination calendar "${destinationCalendarId}"` };

	const eventType = cfg.meetings.find((e) => e.name === appointment.event_type_id);
	const eventTypeName = eventType?.name ?? appointment.event_type_id;

	try {
		const adapter = getCalendarAdapter(cal, cfg.services);
		return await adapter.pushAppointment(cfg, appointment, eventTypeName, opts);
	} catch (err) {
		logger.error(
			{ err, calendarId: cal.name, appointmentId: appointment.id },
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
	externalEventId: string
): Promise<DeleteResult> {
	const cal = cfg.calendars.find((c) => c.name === externalCalendarId);
	if (!cal) return { ok: false, reason: `unknown calendar "${externalCalendarId}"` };

	try {
		const adapter = getCalendarAdapter(cal, cfg.services);
		return await adapter.deleteAppointment(externalEventId);
	} catch (err) {
		logger.error({ err, calendarId: cal.name, externalEventId }, `${cal.type} delete failed`);
		return { ok: false, reason: String(err) };
	}
}
