import {
	generateVideoChat,
	type GenerateVideoChatInput,
	type GenerateVideoChatResult
} from '@when/jobs';
import { parseActionLog, type ActionLogEntry } from '@when/db';
import { getVideoChatAdapter, isCalendarIntegratedVideoChat } from '@when/video-chat';
import { getWorkerContext } from '../services/context.js';
import { reconcileAppointment as syncCalendarForAppointment } from '../calendar/sync.js';
import { appendJobLog } from '../services/job-log.js';
import { implementObservedWorkflow } from '../services/metrics.js';

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

	let generatedUrl: string | null;
	const now = Temporal.Now.instant().toString();

	if (isCalendarIntegratedVideoChat(service)) {
		await syncCalendarForAppointment(ctx, row);
		const refreshed = await ctx.db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', row.id)
			.executeTakeFirstOrThrow();
		generatedUrl = refreshed.video_chat;
	} else {
		const adapter = getVideoChatAdapter(service);
		const roomName = `Meeting: ${row.guest_name}`;
		const result = await adapter.createRoom(roomName);
		if (!result.ok) {
			throw new Error(`Failed to create video chat room: ${result.reason}`);
		}
		generatedUrl = result.url;
		await ctx.db
			.updateTable('appointments')
			.set({
				video_chat: generatedUrl,
				calendar_revision: row.calendar_revision + 1,
				updated_at: now
			})
			.where('id', '=', row.id)
			.execute();
		await appendJobLog(ctx.db, row.id, 'video_chat', 'done', now);
	}

	if (!generatedUrl) {
		throw new Error('Failed to generate video chat URL');
	}

	const actionEntry: ActionLogEntry = {
		action: 'edit',
		actor: 'host',
		at: now,
		payload: {
			field: 'video_chat',
			from: row.video_chat,
			to: generatedUrl
		}
	};
	const fresh = await ctx.db
		.selectFrom('appointments')
		.select('action_log')
		.where('id', '=', row.id)
		.executeTakeFirstOrThrow();

	await ctx.db
		.updateTable('appointments')
		.set({
			action_log: JSON.stringify([...parseActionLog(fresh.action_log), actionEntry])
		})
		.where('id', '=', row.id)
		.execute();

	return { url: generatedUrl };
}

export function registerGenerateVideoChatWorkflow(): void {
	implementObservedWorkflow(generateVideoChat, ({ input }) => runGenerateVideoChat(input));
}
