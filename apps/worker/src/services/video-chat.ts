import { getVideoChatAdapter, isStandaloneVideoChat } from '@when/video-chat';
import type { Kysely } from 'kysely';
import { appendActionLogSql, type Database, type Appointment, type ActionLogEntry } from '@when/db';
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

	if (row.video_chat) {
		return row as Appointment;
	}

	const meeting = config.meetings[row.event_type_id];
	if (!meeting || !meeting.video_chat) {
		return row as Appointment;
	}

	const service = config.providers[meeting.video_chat.provider];
	if (!service || !isStandaloneVideoChat(service)) {
		return row as Appointment;
	}

	const now = Temporal.Now.instant().toString();
	const adapter = getVideoChatAdapter(service);
	const roomName = `Meeting: ${row.guest_name}`;
	const result = await adapter.createRoom(roomName);

	if (!result.ok) {
		throw new Error(`Failed to create video chat room: ${result.reason}`);
	}

	const editEntry: ActionLogEntry = {
		action: 'edit',
		actor: 'host',
		at: now,
		payload: {
			metadata: { changes: ['video_chat_added'] }
		}
	};

	await db
		.updateTable('appointments')
		.set({
			video_chat: result.url,
			calendar_revision: row.calendar_revision + 1,
			action_log: appendActionLogSql(editEntry),
			updated_at: now
		})
		.where('id', '=', appointmentId)
		.execute();

	await appendJobLog(db, appointmentId, 'video_chat', 'done', now);

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

	if (!row || !row.video_chat) {
		return;
	}

	const meeting = config.meetings[row.event_type_id];
	if (!meeting || !meeting.video_chat) {
		return;
	}

	const service = config.providers[meeting.video_chat.provider];
	if (!service || !isStandaloneVideoChat(service)) {
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
	const removeEntry: ActionLogEntry = {
		action: 'edit',
		actor: 'host',
		at: now,
		payload: {
			metadata: { changes: ['video_chat_removed'] }
		}
	};

	await db
		.updateTable('appointments')
		.set({
			video_chat: null,
			action_log: appendActionLogSql(removeEntry),
			updated_at: now
		})
		.where('id', '=', appointmentId)
		.execute();

	await appendJobLog(db, appointmentId, 'video_chat', 'done', now);
}
