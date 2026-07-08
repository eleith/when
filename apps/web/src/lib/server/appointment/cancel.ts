import { resolveAppointmentActions, type Viewer } from './actions';
import { enqueueAppointmentReconciliation } from '../workflow';
import type { AppointmentContext } from './context';
import { cancelAppointmentTransition } from './transitions';
import type { Appointment } from '@when/db';

export interface CancelAppointmentInput {
	appointment: Appointment;
	initiator: Viewer;
	reason?: string;
}

export type CancelAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'conflict' };

export async function cancelAppointment(
	ctx: AppointmentContext,
	input: CancelAppointmentInput
): Promise<CancelAppointmentResult> {
	const eventType = ctx.cfg.meetings.find((e) => e.name === input.appointment.event_type_id);

	const gate = resolveAppointmentActions({
		row: input.appointment,
		viewer: input.initiator,
		now: ctx.clock.now(),
		eventType
	}).cancel;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	const result = await cancelAppointmentTransition(
		ctx.db,
		input.appointment.id,
		input.initiator === 'host' ? 'host' : 'guest',
		ctx.clock.now().toISOString(),
		input.reason
	);
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const kind = input.initiator === 'host' ? 'cancelled-by-host' : 'cancelled-by-guest';
	const appointment = await enqueueAppointmentReconciliation(ctx.db, input.appointment.id, kind);

	return { ok: true, appointment };
}
