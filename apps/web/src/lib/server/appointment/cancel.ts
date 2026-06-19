import { resolveBookingActions, type Viewer } from './actions';
import { enqueueBookingEmail, enqueueCalendarSync } from '../workflow';
import type { BookingContext } from './context';
import { cancelBooking } from './transitions';
import type { Appointment } from '@when/db';

export interface CancelAppointmentInput {
	appointment: Appointment;
	initiator: Viewer;
}

export type CancelAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'conflict' };

export async function cancelAppointment(
	ctx: BookingContext,
	input: CancelAppointmentInput
): Promise<CancelAppointmentResult> {
	const eventType = ctx.cfg.event_types.find((e) => e.id === input.appointment.event_type_id);

	const gate = resolveBookingActions({
		row: input.appointment,
		viewer: input.initiator,
		now: ctx.clock.now(),
		eventType
	}).cancel;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	const result = await cancelBooking(ctx.db, input.appointment.id);
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const kind = input.initiator === 'organizer' ? 'cancelled-by-organizer' : 'cancelled-by-attendee';
	const appointment = await enqueueBookingEmail(ctx.db, input.appointment.id, kind);
	await enqueueCalendarSync();

	return { ok: true, appointment };
}
