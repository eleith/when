import { resolveAppointmentActions } from './actions';
import { enqueueAppointmentReconciliation } from '../workflow';
import type { AppointmentContext } from './context';
import { declineAppointmentTransition } from './transitions';
import { getAppointment, type Appointment } from '@when/db';

export interface DeclineAppointmentInput {
	appointment: Appointment;
	note?: string;
}

export type DeclineAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'conflict' };

export async function declineAppointment(
	ctx: AppointmentContext,
	input: DeclineAppointmentInput
): Promise<DeclineAppointmentResult> {
	const eventType = ctx.cfg.meetings[input.appointment.event_type_id];

	const gate = resolveAppointmentActions({
		row: input.appointment,
		role: 'host',
		now: ctx.clock.now(),
		eventType
	}).decline;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	const result = await declineAppointmentTransition(
		ctx.db,
		input.appointment.id,
		ctx.clock.now().toISOString(),
		input.note
	);
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const appointment = await getAppointment(ctx.db, input.appointment.id);
	await enqueueAppointmentReconciliation(appointment, 'declined');

	return { ok: true, appointment };
}
