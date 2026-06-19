import { resolveBookingActions } from './actions';
import { enqueueBookingEmail, enqueueCalendarSync } from '../workflow';
import type { BookingContext } from './context';
import { confirmBooking } from './transitions';
import type { Appointment } from '@when/db';

export interface AcceptAppointmentInput {
	appointment: Appointment;
}

export type AcceptAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'conflict' };

export async function acceptAppointment(
	ctx: BookingContext,
	input: AcceptAppointmentInput
): Promise<AcceptAppointmentResult> {
	const eventType = ctx.cfg.event_types.find((e) => e.id === input.appointment.event_type_id);

	const gate = resolveBookingActions({
		row: input.appointment,
		viewer: 'organizer',
		now: ctx.clock.now(),
		eventType
	}).accept;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	const result = await confirmBooking(ctx.db, input.appointment.id);
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const appointment = await enqueueBookingEmail(ctx.db, input.appointment.id, 'confirmed');
	await enqueueCalendarSync();

	return { ok: true, appointment };
}
