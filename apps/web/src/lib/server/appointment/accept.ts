import { resolveAppointmentActions } from './actions';
import { enqueueAppointmentReconciliation } from '../workflow';
import type { AppointmentContext } from './context';
import { confirmAppointment } from './transitions';
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
		viewer: 'host',
		now: ctx.clock.now(),
		eventType
	}).accept;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	const result = await confirmAppointment(
		ctx.db,
		input.appointment.id,
		ctx.clock.now().toISOString()
	);
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const appointment = await enqueueAppointmentReconciliation(
		ctx.db,
		input.appointment.id,
		'confirmed'
	);

	return { ok: true, appointment };
}
