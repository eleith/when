import { sql } from 'kysely';
import { isTerminalStatus } from './actions';
import { enqueueAppointmentEmail, enqueueCalendarSync } from '../workflow';
import type { AppointmentContext } from './context';
import { appendActionLogSql, type Appointment } from '@when/db';

export interface EditAppointmentInput {
	appointment: Appointment;
	note?: string | null;
	location?: string | null;
}

export type EditAppointmentResult =
	| { ok: true; appointment: Appointment }
	| { ok: false; reason: 'gated' | 'no_changes' | 'conflict' };

function detectFieldChange(
	oldVal: string | null,
	newVal: string | null | undefined
): 'added' | 'removed' | 'updated' | null {
	const cleanOld = oldVal?.trim() || null;
	const cleanNew = newVal === undefined ? undefined : newVal?.trim() || null;

	if (cleanNew === undefined || cleanNew === cleanOld) {
		return null;
	}
	if (!cleanOld && cleanNew) {
		return 'added';
	}
	if (cleanOld && !cleanNew) {
		return 'removed';
	}
	return 'updated';
}

export async function editAppointment(
	ctx: AppointmentContext,
	input: EditAppointmentInput
): Promise<EditAppointmentResult> {
	const appointment = input.appointment;

	if (
		isTerminalStatus(appointment.status) ||
		ctx.clock.now().getTime() >= Date.parse(appointment.end_time)
	) {
		return { ok: false, reason: 'gated' };
	}

	const changes: (
		| 'note_added'
		| 'note_updated'
		| 'note_removed'
		| 'location_added'
		| 'location_updated'
		| 'location_removed'
	)[] = [];

	const noteValue = input.note !== undefined ? input.note?.trim() || null : appointment.note;
	const locationValue =
		input.location !== undefined ? input.location?.trim() || null : appointment.location;

	const noteChange = detectFieldChange(appointment.note, input.note);
	if (noteChange) {
		changes.push(`note_${noteChange}`);
	}

	const locationChange = detectFieldChange(appointment.location, input.location);
	if (locationChange) {
		changes.push(`location_${locationChange}`);
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
			location: locationValue,
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
