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

		const details = editDetails(appointment, input);
		const contentChanged = details.changes.length > 0;
		const choiceChanged = details.fields.video_chat_request !== appointment.video_chat_request;
		if (!contentChanged && !choiceChanged) {
			return { ok: false, reason: 'no_changes' } as const;
		}

		let update = connection
			.updateTable('appointments')
			.set({
				...details.fields,
				calendar_revision: sql`calendar_revision + 1`,
				updated_at: sql`CURRENT_TIMESTAMP`
			})
			.where('id', '=', appointment.id)
			.where('status', 'in', ['pending', 'confirmed']);
		if (contentChanged) {
			update = update.set({
				ics_sequence: sql`ics_sequence + 1`,
				action_log: appendActionLogSql({
					action: 'edit',
					actor: 'host',
					at: ctx.clock.now().toISOString(),
					payload: { metadata: { changes: details.changes } }
				})
			});
		}
		const updated = await update.returningAll().executeTakeFirst();
		if (!updated) return { ok: false, reason: 'conflict' } as const;

		return {
			ok: true as const,
			appointment: updated,
			contentChanged,
			cleanupVideoChatUrl: details.cleanupVideoChatUrl
		};
	});
	if (!committed.ok) return committed;

	await enqueueAppointmentReconciliation(
		committed.appointment,
		committed.contentChanged ? 'edited-by-host' : undefined,
		committed.cleanupVideoChatUrl
	);
	return { ok: true, appointment: committed.appointment };
}

function editDetails(appointment: Appointment, input: EditAppointmentInput) {
	const fields: Pick<Appointment, 'note' | 'location' | 'video_chat' | 'video_chat_request'> = {
		note: appointment.note,
		location: appointment.location,
		video_chat: appointment.video_chat,
		video_chat_request: input.video_chat === undefined ? appointment.video_chat_request : 'suppress'
	};
	const changes: string[] = [];
	for (const field of ['note', 'location', 'video_chat'] as const) {
		const value = input[field];
		const change = detectFieldChange(appointment[field], value);
		if (change) changes.push(`${field}_${change}`);
		if (value !== undefined) fields[field] = cleanGuestText(value ?? '', field === 'note') || null;
	}
	const videoChatWasReplaced =
		changes.includes('video_chat_removed') || changes.includes('video_chat_updated');
	const cleanupVideoChatUrl = videoChatWasReplaced ? appointment.video_chat : null;
	return { fields, changes, cleanupVideoChatUrl };
}
