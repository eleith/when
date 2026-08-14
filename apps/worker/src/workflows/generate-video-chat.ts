import {
	generateVideoChat,
	type GenerateVideoChatInput,
	type GenerateVideoChatResult
} from '@when/jobs';
import { isCalendarIntegratedVideoChat } from '@when/video-chat';
import { appendActionLogSql, type ActionLogEntry, type Appointment } from '@when/db';
import { getWorkerContext } from '../services/context.js';
import { createStandaloneVideoChat } from '../services/video-chat.js';
import { reconcileAppointment as syncCalendarForAppointment } from '../calendar/sync.js';
import { dispatch } from '../email/dispatch.js';
import { recordSendOutcome } from '../email/status.js';
import { implementObservedWorkflow, emailsTotal } from '../services/metrics.js';

export async function runGenerateVideoChat(
	input: GenerateVideoChatInput
): Promise<GenerateVideoChatResult> {
	const ctx = getWorkerContext();
	const row = await ctx.db
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', input.appointmentId)
		.executeTakeFirst();

	if (!row) {
		throw new Error(`Appointment "${input.appointmentId}" not found`);
	}

	if (row.video_chat) {
		return { url: row.video_chat };
	}

	const meeting = ctx.config.meetings[row.event_type_id];
	if (!meeting || !meeting.video_chat) {
		throw new Error(`Meeting "${row.event_type_id}" does not have video chat configured`);
	}

	const service = ctx.config.providers[meeting.video_chat.provider];
	if (!service) {
		throw new Error(`Video chat provider "${meeting.video_chat.provider}" not found`);
	}

	let finalRow: Appointment;

	if (isCalendarIntegratedVideoChat(service)) {
		await syncCalendarForAppointment(ctx, row as Appointment, { attachVideoChat: true });
		const refreshed = (await ctx.db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', row.id)
			.executeTakeFirstOrThrow()) as Appointment;
		if (!refreshed.video_chat) {
			throw new Error('Failed to generate video chat URL');
		}

		const now = Temporal.Now.instant().toString();
		const editEntry: ActionLogEntry = {
			action: 'edit',
			actor: 'host',
			at: now,
			payload: {
				metadata: { changes: ['video_chat_added'] }
			}
		};

		await ctx.db
			.updateTable('appointments')
			.set({
				action_log: appendActionLogSql(editEntry),
				updated_at: now
			})
			.where('id', '=', row.id)
			.execute();

		finalRow = (await ctx.db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', row.id)
			.executeTakeFirstOrThrow()) as Appointment;
	} else {
		const updated = await createStandaloneVideoChat(ctx.db, row.id, ctx.config);
		if (!updated.video_chat) {
			throw new Error('Failed to generate video chat URL');
		}
		// Sync the calendar event so the new video chat link is reflected on the calendar
		await syncCalendarForAppointment(ctx, updated);
		finalRow = (await ctx.db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', row.id)
			.executeTakeFirstOrThrow()) as Appointment;
	}

	// Dispatch 'edited-by-host' email notifications
	try {
		const envelopes = await dispatch({ kind: 'edited-by-host', appointment: finalRow }, ctx.config);
		for (const envelope of envelopes) {
			const recipientType = envelope.to === ctx.config.user.email ? 'host' : 'guest';
			try {
				const result = await ctx.mailer.send(envelope);
				await recordSendOutcome(ctx, result);
				emailsTotal.inc({
					recipient_type: recipientType,
					email_kind: 'edited-by-host',
					status: result.ok ? 'success' : 'failure'
				});
			} catch (err) {
				emailsTotal.inc({
					recipient_type: recipientType,
					email_kind: 'edited-by-host',
					status: 'failure'
				});
				ctx.logger.error(
					{
						appointmentId: row.id,
						recipientType,
						error: err instanceof Error ? err.message : String(err)
					},
					'failed to send edited-by-host email after generating video chat'
				);
			}
		}
	} catch (err) {
		ctx.logger.error(
			{
				appointmentId: row.id,
				error: err instanceof Error ? err.message : String(err)
			},
			'failed to dispatch edited-by-host emails after generating video chat'
		);
	}

	return { url: finalRow.video_chat! };
}

export function registerGenerateVideoChatWorkflow(): void {
	implementObservedWorkflow(generateVideoChat, ({ input }) => runGenerateVideoChat(input));
}
