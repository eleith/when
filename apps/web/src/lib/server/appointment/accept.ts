import { resolveAppointmentActions } from './actions';
import { enqueueAppointmentEmail, enqueueCalendarSync } from '../workflow';
import type { AppointmentContext } from './context';
import { confirmBooking } from './transitions';
import type { Appointment } from '@when/db';

export interface AcceptAppointmentInput {
	appointment: Appointment;
}

export type AcceptAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'conflict' };

export async function acceptAppointment(
	ctx: AppointmentContext,
	input: AcceptAppointmentInput
): Promise<AcceptAppointmentResult> {
	const eventType = ctx.cfg.event_types.find((e) => e.id === input.appointment.event_type_id);

	const gate = resolveAppointmentActions({
		row: input.appointment,
		viewer: 'organizer',
		now: ctx.clock.now(),
		eventType
	}).accept;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	const result = await confirmBooking(ctx.db, input.appointment.id);
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const appointment = await enqueueAppointmentEmail(ctx.db, input.appointment.id, 'confirmed');
	await enqueueCalendarSync();

	return { ok: true, appointment };
}
