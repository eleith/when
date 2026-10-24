import { sql } from 'kysely';
import {
	appendActionLogSql,
	findAppointment,
	withWriteTransaction,
	type Appointment
} from '@when/db';
import { isEditAllowed } from './access';
import { resolveBookingDurations } from './duration';
import type { AppointmentContext } from './context';
import { hasAppointmentConflict } from '../availability/conflicts';
import { enqueueAppointmentReconciliation } from '../workflow';

export type ChangeDurationResult =
	| { ok: true; outcome: 'updated' | 'unchanged'; appointment: Appointment }
	| {
			ok: false;
			reason: 'not_found' | 'gated' | 'not_configured' | 'invalid_duration' | 'past_end' | 'busy';
	  }
	| { ok: false; reason: 'enqueue_failed'; durationSaved: true };

export async function changeAppointmentDuration(
	ctx: AppointmentContext,
	input: { appointmentId: string; durationMinutes: number }
): Promise<ChangeDurationResult> {
	const committed = await withWriteTransaction(ctx.db, async (connection) => {
		const appointment = await findAppointment(connection, input.appointmentId);
		if (!appointment) return { ok: false, reason: 'not_found' } as const;
		const now = ctx.clock.now();
		if (!isEditAllowed(appointment, now)) {
			return { ok: false, reason: 'gated' } as const;
		}

		const meeting = ctx.cfg.meetings[appointment.event_type_id];
		if (!meeting) return { ok: false, reason: 'not_configured' } as const;
		const profile = resolveBookingDurations(meeting, 'host', appointment);
		if (
			!Number.isSafeInteger(input.durationMinutes) ||
			!profile.durations.includes(input.durationMinutes)
		) {
			return { ok: false, reason: 'invalid_duration' } as const;
		}
		if (input.durationMinutes === profile.defaultDuration) {
			return { ok: true, outcome: 'unchanged', appointment } as const;
		}

		const start = Temporal.Instant.from(appointment.start_time);
		const end = start.add({ minutes: input.durationMinutes });
		if (end.epochMilliseconds <= now.getTime()) return { ok: false, reason: 'past_end' } as const;
		const busy = await hasAppointmentConflict(connection, meeting, { start, end }, appointment.id);
		if (busy) return { ok: false, reason: 'busy' } as const;

		const updated = await connection
			.updateTable('appointments')
			.set({
				end_time: end.toString(),
				calendar_revision: sql`calendar_revision + 1`,
				ics_sequence: sql`ics_sequence + 1`,
				updated_at: sql`CURRENT_TIMESTAMP`,
				action_log: appendActionLogSql({
					action: 'edit',
					actor: 'host',
					at: now.toISOString(),
					payload: {
						metadata: {
							changes: ['duration_updated'],
							previous_duration: profile.defaultDuration,
							duration: input.durationMinutes
						}
					}
				})
			})
			.where('id', '=', appointment.id)
			.where('status', 'in', ['pending', 'confirmed'])
			.returningAll()
			.executeTakeFirstOrThrow();
		return { ok: true, outcome: 'updated', appointment: updated } as const;
	});
	if (!committed.ok || committed.outcome === 'unchanged') return committed;

	try {
		await enqueueAppointmentReconciliation(committed.appointment, 'edited-by-host');
	} catch {
		return { ok: false, reason: 'enqueue_failed', durationSaved: true };
	}
	return committed;
}
