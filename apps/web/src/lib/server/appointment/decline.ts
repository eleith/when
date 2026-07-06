import { resolveAppointmentActions } from './actions';
import { enqueueAppointmentReconciliation } from '../workflow';
import type { AppointmentContext } from './context';
import { declineAppointmentTransition } from './transitions';
import type { Appointment } from '@when/db';

export interface DeclineAppointmentInput {
	appointment: Appointment;
}

export type DeclineAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'conflict' };

export async function declineAppointment(
	ctx: AppointmentContext,
	input: DeclineAppointmentInput
): Promise<DeclineAppointmentResult> {
	const eventType = ctx.cfg.event_types.find((e) => e.id === input.appointment.event_type_id);

	const gate = resolveAppointmentActions({
		row: input.appointment,
		viewer: 'host',
		now: ctx.clock.now(),
		eventType
	}).decline;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	// Decline never touches the calendar (pending appointments aren't synced), so no sync.
	const result = await declineAppointmentTransition(
		ctx.db,
		input.appointment.id,
		ctx.clock.now().toISOString()
	);
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const appointment = await enqueueAppointmentReconciliation(ctx.db, input.appointment.id, 'declined');

	return { ok: true, appointment };
}
