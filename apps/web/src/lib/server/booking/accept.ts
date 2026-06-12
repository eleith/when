import type { Kysely } from 'kysely';
import { resolveBookingActions } from './actions';
import { enqueueBookingEmail, enqueueCalendarSync } from '../workflow';
import { confirmBooking } from './transitions';
import type { Clock } from '../clock';
import type { WhenConfiguration } from '@when/config';
import type { Appointment, Database } from '@when/db';

export interface AcceptAppointmentDeps {
	db: Kysely<Database>;
	cfg: WhenConfiguration;
	clock: Clock;
}

export interface AcceptAppointmentInput {
	appointment: Appointment;
	baseUrl: string;
}

export type AcceptAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'conflict' };

export async function acceptAppointment(
	deps: AcceptAppointmentDeps,
	input: AcceptAppointmentInput
): Promise<AcceptAppointmentResult> {
	const eventType = deps.cfg.event_types.find((e) => e.id === input.appointment.event_type_id);

	const gate = resolveBookingActions({
		row: input.appointment,
		viewer: 'organizer',
		now: deps.clock.now(),
		eventType
	}).accept;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	const result = await confirmBooking(deps.db, input.appointment.id);
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const appointment = await enqueueBookingEmail(deps.db, input.appointment.id, 'confirmed');
	await enqueueCalendarSync();

	return { ok: true, appointment };
}
