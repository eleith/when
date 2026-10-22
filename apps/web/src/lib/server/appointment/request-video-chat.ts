import { findAppointment, recordVideoChatGenerationRequest, withWriteTransaction } from '@when/db';
import { enqueueVideoChatGeneration } from '../workflow';
import { resolveGenerateVideoChat } from './actions';
import type { AppointmentContext } from './context';

export type RequestVideoChatResult =
	| { ok: true; outcome: 'requested' | 'already_linked' }
	| { ok: false; reason: 'not_found' | 'gated' | 'not_configured' }
	| { ok: false; reason: 'enqueue_failed'; choiceSaved: true };

export async function requestVideoChat(
	ctx: AppointmentContext,
	input: { appointmentId: string }
): Promise<RequestVideoChatResult> {
	const committed = await withWriteTransaction(ctx.db, async (connection) => {
		const appointment = await findAppointment(connection, input.appointmentId);
		if (!appointment) return { ok: false, reason: 'not_found' } as const;

		const eventType = ctx.cfg.meetings[appointment.event_type_id];
		const gate = resolveGenerateVideoChat(appointment, 'host', eventType?.video_chat);
		if (!gate.allowed) {
			const reason = gate.reason === 'not_configured' ? 'not_configured' : 'gated';
			return { ok: false, reason } as const;
		}
		if (appointment.video_chat) return { ok: true, outcome: 'already_linked' } as const;

		const calendarRevision = await recordVideoChatGenerationRequest(connection, appointment.id);
		return { ok: true, outcome: 'requested', calendarRevision } as const;
	});
	if (!committed.ok || committed.outcome === 'already_linked') return committed;

	try {
		await enqueueVideoChatGeneration(input.appointmentId, committed.calendarRevision);
	} catch {
		return { ok: false, reason: 'enqueue_failed', choiceSaved: true };
	}
	return { ok: true, outcome: 'requested' };
}
