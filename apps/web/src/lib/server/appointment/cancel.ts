import { resolveAppointmentActions, type Viewer } from './actions';
import { enqueueAppointmentEmail, enqueueCalendarSync } from '../workflow';
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
	const eventType = ctx.cfg.event_types.find((e) => e.id === input.appointment.event_type_id);

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
		input.initiator === 'organizer' ? 'organizer' : 'attendee',
		ctx.clock.now().toISOString(),
		input.reason
	);
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const kind = input.initiator === 'organizer' ? 'cancelled-by-organizer' : 'cancelled-by-attendee';
	const appointment = await enqueueAppointmentEmail(ctx.db, input.appointment.id, kind);
	await enqueueCalendarSync();

	return { ok: true, appointment };
}
