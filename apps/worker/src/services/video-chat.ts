import { getVideoChatAdapter } from '@when/video-chat';
import { pushAppointment } from '@when/calendar';
import type { Kysely } from 'kysely';
import type { Database, Appointment } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { appointmentLinks } from '../links.js';
import { appendJobLog } from './job-log.js';

export async function ensureVideoChatLink(
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

	const now = Temporal.Now.instant().toString();

	if (vcConfig.type === 'nextcloud-talk') {
		const adapter = getVideoChatAdapter(vcConfig, config);
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
	} else if (vcConfig.type === 'google-meet') {
		const eventType = config.event_types.find((e) => e.id === row.event_type_id);
		const targetCalendarId = row.external_calendar_id ?? eventType?.destination_calendar ?? null;
		if (!targetCalendarId) {
			throw new Error(
				`Google Meet requires a destination calendar for appointment "${appointmentId}"`
			);
		}

		const cancelUrl = appointmentLinks({
			baseUrl: config.url.app,
			appointment: row
		}).booked;

		const pushed = await pushAppointment(config, row, targetCalendarId, {
			cancelUrl
		});

		if (!pushed.ok) {
			throw new Error(`Google Calendar push for Google Meet failed: ${pushed.reason}`);
		}

		if (!pushed.videoChatUrl) {
			throw new Error(`Google Calendar push did not return a Google Meet URL`);
		}

		row = await db
			.updateTable('appointments')
			.set({
				video_chat: pushed.videoChatUrl,
				external_event_id: pushed.externalEventId,
				external_calendar_id: pushed.externalCalendarId,
				calendar_synced_revision: row.calendar_revision,
				updated_at: now
			})
			.where('id', '=', appointmentId)
			.returningAll()
			.executeTakeFirstOrThrow();

		await appendJobLog(db, appointmentId, 'video_chat', 'done', now);
		await appendJobLog(db, appointmentId, 'calendar', 'done', now);
	}

	return (await db
		.selectFrom('appointments')
		.selectAll()
		.where('id', '=', appointmentId)
		.executeTakeFirstOrThrow()) as Appointment;
}

export async function cleanupVideoChatLink(
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
		const adapter = getVideoChatAdapter(vcConfig, config);
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
