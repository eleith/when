import { sql } from 'kysely';
import { isTerminalStatus } from './actions';
import { enqueueAppointmentEmail, enqueueCalendarSync } from '../workflow';
import type { AppointmentContext } from './context';
import { appendActionLogSql, type Appointment } from '@when/db';

export interface EditAppointmentInput {
	appointment: Appointment;
	note?: string | null;
}

export type EditAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'no_changes' | 'conflict' };

export async function editAppointment(
	ctx: AppointmentContext,
	input: EditAppointmentInput
): Promise<EditAppointmentResult> {
	const appointment = input.appointment;

	if (isTerminalStatus(appointment.status)) {
		return { ok: false, reason: 'gated' };
	}

	const changes: ('note_added' | 'note_updated' | 'note_removed')[] = [];
	const noteValue = input.note !== undefined ? input.note : appointment.note;

	if (input.note !== undefined && input.note !== appointment.note) {
		const oldNote = appointment.note;
		const newNote = input.note;
		if (!oldNote && newNote) {
			changes.push('note_added');
		} else if (oldNote && !newNote) {
			changes.push('note_removed');
		} else {
			changes.push('note_updated');
		}
	}

	if (changes.length === 0) {
		return { ok: false, reason: 'no_changes' };
	}

	const nowStr = ctx.clock.now().toISOString();
	const editEntry = {
		action: 'edit' as const,
		actor: 'host' as const,
		at: nowStr,
		payload: {
			metadata: { changes }
		}
	};

	const updated = await ctx.db
		.updateTable('appointments')
		.set({
			note: noteValue,
			ics_sequence: sql`ics_sequence + 1`,
			calendar_revision: sql`calendar_revision + 1`,
			action_log: appendActionLogSql(editEntry),
			updated_at: sql`CURRENT_TIMESTAMP`
		})
		.where('id', '=', appointment.id)
		.where('status', 'in', ['pending', 'confirmed'])
		.returningAll()
		.executeTakeFirst();

	if (!updated) {
		return { ok: false, reason: 'conflict' };
	}

	await enqueueAppointmentEmail(ctx.db, updated.id, 'edited-by-host');
	await enqueueCalendarSync();

	return { ok: true, appointment: updated };
}
