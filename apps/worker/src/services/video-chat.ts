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
	const row = await db
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

	const meeting = config.meetings.find((m) => m.name === row.event_type_id);
	if (!meeting || !meeting.video_chat_provider) {
		return row as Appointment;
	}

	const service = config.providers.find((s) => s.name === meeting.video_chat_provider);
	if (!service) {
		throw new Error(`Video chat provider "${meeting.video_chat_provider}" not found`);
	}

	// We ONLY handle standalone video chat providers here (like Nextcloud Talk).
	// Google Meet is calendar-integrated, so its creation is handled by the Calendar Sync step.
	if (service.type === 'nextcloud' && row.video_chat === 'nextcloud-talk') {
		const now = Temporal.Now.instant().toString();
		const adapter = getVideoChatAdapter(service);
		const roomName = `Meeting: ${row.guest_name}`;
		const result = await adapter.createRoom(roomName);

		if (!result.ok) {
			throw new Error(`Failed to create Nextcloud Talk room: ${result.reason}`);
		}

		await db
			.updateTable('appointments')
			.set({
				video_chat: result.url,
				calendar_revision: row.calendar_revision + 1,
				updated_at: now
			})
			.where('id', '=', appointmentId)
			.execute();

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

	const meeting = config.meetings.find((e) => e.name === row.event_type_id);
	if (!meeting || !meeting.video_chat_provider) {
		return;
	}

	const service = config.providers.find((s) => s.name === meeting.video_chat_provider);
	if (!service || service.type !== 'nextcloud') {
		return;
	}

	try {
		const adapter = getVideoChatAdapter(service);
		const deleteResult = await adapter.deleteRoom(row.video_chat);
		if (!deleteResult.ok) {
			console.warn(`Failed to delete video chat room: ${deleteResult.reason}`);
		}
	} catch (err) {
		console.warn(
			`Error deleting video chat room: ${err instanceof Error ? err.message : String(err)}`
		);
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
