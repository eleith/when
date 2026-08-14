import {
	generateVideoChat,
	type GenerateVideoChatInput,
	type GenerateVideoChatResult
} from '@when/jobs';
import { isCalendarIntegratedVideoChat } from '@when/video-chat';
import { getWorkerContext } from '../services/context.js';
import { createStandaloneVideoChat } from '../services/video-chat.js';
import { reconcileAppointment as syncCalendarForAppointment } from '../calendar/sync.js';
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

	if (isCalendarIntegratedVideoChat(service)) {
		await syncCalendarForAppointment(ctx, row);
		const refreshed = await ctx.db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', row.id)
			.executeTakeFirstOrThrow();
		if (!refreshed.video_chat) {
			throw new Error('Failed to generate video chat URL');
		}
		return { url: refreshed.video_chat };
	}

	const updated = await createStandaloneVideoChat(ctx.db, row.id, ctx.config);
	if (!updated.video_chat) {
		throw new Error('Failed to generate video chat URL');
	}
	return { url: updated.video_chat };
}

export function registerGenerateVideoChatWorkflow(): void {
	implementObservedWorkflow(generateVideoChat, ({ input }) => runGenerateVideoChat(input));
}
