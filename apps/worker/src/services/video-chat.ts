import { getVideoChatAdapter } from '@when/video-chat';
import type { Kysely } from 'kysely';
import type { Database, Appointment } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { appendJobLog } from './job-log.js';

export async function createStandaloneVideoChat(
	db: Kysely<Database>,
	appointmentId: string,
	config: WhenConfiguration
): Promise<Appointment> {
	let row = await db
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', appointmentId)
		.executeTakeFirstOrThrow();

	if (row.status !== 'confirmed' && row.status !== 'pending') {
		return row as Appointment;
	}

	if (!row.video_chat || row.video_chat.startsWith('http')) {
		return row as Appointment;
	}

	const videoChatId = row.video_chat;
	const vcConfig = (config.video_chats ?? []).find((vc) => vc.id === videoChatId);
	if (!vcConfig) {
		throw new Error(`Video chat configuration "${videoChatId}" not found`);
	}

	// We ONLY handle standalone video chat providers here (like Nextcloud Talk).
	// Google Meet is calendar-integrated, so its creation is handled by the Calendar Sync step.
	if (vcConfig.type === 'nextcloud-talk') {
		const now = Temporal.Now.instant().toString();
		const adapter = getVideoChatAdapter(vcConfig, config.services);
		const roomName = `Meeting: ${row.guest_name}`;
		const result = await adapter.createRoom(roomName);

		if (!result.ok) {
			throw new Error(`Failed to create Nextcloud Talk room: ${result.reason}`);
		}

		row = await db
			.updateTable('appointments')
			.set({
				video_chat: result.url,
				calendar_revision: row.calendar_revision + 1,
				updated_at: now
			})
			.where('id', '=', appointmentId)
			.returningAll()
			.executeTakeFirstOrThrow();

		await appendJobLog(db, appointmentId, 'video_chat', 'done', now);
	}

	return (await db
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', appointmentId)
		.executeTakeFirstOrThrow()) as Appointment;
}

export async function deleteStandaloneVideoChat(
	db: Kysely<Database>,
	appointmentId: string,
	config: WhenConfiguration
): Promise<void> {
	const row = await db
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', appointmentId)
		.executeTakeFirst();

	if (!row || !row.video_chat || !row.video_chat.startsWith('http')) {
		return;
	}

	const eventType = config.event_types.find((e) => e.id === row.event_type_id);
	if (!eventType || !eventType.video_chat) {
		return;
	}

	const vcConfig = (config.video_chats ?? []).find((vc) => vc.id === eventType.video_chat);
	if (!vcConfig) {
		return;
	}

	try {
		const adapter = getVideoChatAdapter(vcConfig, config.services);
		const deleteResult = await adapter.deleteRoom(row.video_chat);
		if (!deleteResult.ok) {
			console.warn(`Failed to delete video chat room: ${deleteResult.reason}`);
		}
	} catch (err) {
		console.warn(`Error deleting video chat room: ${err instanceof Error ? err.message : String(err)}`);
	}

	const now = Temporal.Now.instant().toString();
	await db
		.updateTable('appointments')
		.set({
			video_chat: null,
			updated_at: now
		})
		.where('id', '=', appointmentId)
		.execute();

	await appendJobLog(db, appointmentId, 'video_chat', 'done', now);
}
