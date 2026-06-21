import { originId, type Appointment } from '@when/db';
import type { AppointmentContext } from './context';
import { purgeChainTransition } from './transitions';
import { enqueuePurgeAppointment } from '../workflow';

export interface PurgeAppointmentInput {
	appointment: Appointment;
}

export type PurgeAppointmentResult = { ok: true } | { ok: false; reason: 'already_purged' };

export async function purgeAppointment(
	ctx: AppointmentContext,
	input: PurgeAppointmentInput
): Promise<PurgeAppointmentResult> {
	const rows = await purgeChainTransition(ctx.db, originId(input.appointment));
	if (!rows) return { ok: false, reason: 'already_purged' };

	await enqueuePurgeAppointment(
		rows.map((r) => ({
			id: r.id,
			externalEventId: r.external_event_id,
			externalCalendarId: r.external_calendar_id
		}))
	);
	return { ok: true };
}
