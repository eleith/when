import type { Kysely } from 'kysely';
import { resolveBookingActions } from './actions';
import { enqueueBookingEmail } from '../workflow';
import { declineBooking } from './transitions';
import type { Clock } from '../clock';
import type { WhenConfiguration } from '@when/config';
import type { Appointment, Database } from '@when/db';

export interface DeclineAppointmentDeps {
	db: Kysely<Database>;
	cfg: WhenConfiguration;
	clock: Clock;
}

export interface DeclineAppointmentInput {
	appointment: Appointment;
	baseUrl: string;
}

export type DeclineAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'conflict' };

export async function declineAppointment(
	deps: DeclineAppointmentDeps,
	input: DeclineAppointmentInput
): Promise<DeclineAppointmentResult> {
	const eventType = deps.cfg.event_types.find((e) => e.id === input.appointment.event_type_id);

	const gate = resolveBookingActions({
		row: input.appointment,
		viewer: 'organizer',
		now: deps.clock.now(),
		eventType
	}).decline;
	if (!gate.allowed) return { ok: false, reason: 'gated' };

	// Decline never touches the calendar (pending bookings aren't synced), so no sync.
	const result = await declineBooking(deps.db, input.appointment.id);
	if (!result.ok) return { ok: false, reason: 'conflict' };

	const appointment = await enqueueBookingEmail(deps.db, input.appointment.id, 'declined');

	return { ok: true, appointment };
}
