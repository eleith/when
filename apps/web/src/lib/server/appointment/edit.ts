import { cleanGuestText } from './form.server';
import { sql } from 'kysely';
import { isTerminalStatus } from './actions';
import { enqueueAppointmentReconciliation } from '../workflow';
import type { AppointmentContext } from './context';
import {
	appendActionLogSql,
	findAppointment,
	withWriteTransaction,
	type Appointment
} from '@when/db';

export interface EditAppointmentInput {
	appointmentId: string;
	note?: string | null;
	location?: string | null;
	video_chat?: string | null;
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
	const committed = await withWriteTransaction(ctx.db, async (connection) => {
		const appointment = await findAppointment(connection, input.appointmentId);
		if (!appointment) return { ok: false, reason: 'conflict' } as const;
		if (
			isTerminalStatus(appointment.status) ||
			ctx.clock.now().getTime() >= Date.parse(appointment.end_time)
		) {
			return { ok: false, reason: 'gated' } as const;
		}

		const fields = {
			note: appointment.note,
			location: appointment.location,
			video_chat: appointment.video_chat
		};
		const changes: string[] = [];
		for (const field of ['note', 'location', 'video_chat'] as const) {
			const value = input[field];
			const change = detectFieldChange(appointment[field], value);
			if (change) changes.push(`${field}_${change}`);
			if (value !== undefined) {
				fields[field] = cleanGuestText(value ?? '', field === 'note') || null;
			}
		}
		if (changes.length === 0) return { ok: false, reason: 'no_changes' } as const;

		const updated = await connection
			.updateTable('appointments')
			.set({
				...fields,
				ics_sequence: sql`ics_sequence + 1`,
				calendar_revision: sql`calendar_revision + 1`,
				action_log: appendActionLogSql({
					action: 'edit',
					actor: 'host',
					at: ctx.clock.now().toISOString(),
					payload: { metadata: { changes } }
				}),
				updated_at: sql`CURRENT_TIMESTAMP`
			})
			.where('id', '=', appointment.id)
			.where('status', 'in', ['pending', 'confirmed'])
			.returningAll()
			.executeTakeFirst();
		if (!updated) return { ok: false, reason: 'conflict' } as const;

		const videoChatWasReplaced =
			changes.includes('video_chat_removed') || changes.includes('video_chat_updated');
		const cleanupVideoChatUrl = videoChatWasReplaced ? appointment.video_chat : null;
		return { ok: true as const, appointment: updated, cleanupVideoChatUrl };
	});
	if (!committed.ok) return committed;

	await enqueueAppointmentReconciliation(
		ctx.db,
		committed.appointment.id,
		'edited-by-host',
		committed.cleanupVideoChatUrl
	);
	return { ok: true, appointment: committed.appointment };
}
