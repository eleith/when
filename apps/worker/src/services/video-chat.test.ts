import { describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations, parseActionLog } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { ensureVideoChatLink } from './video-chat.js';
import { getVideoChatAdapter } from '@when/video-chat';
import { pushAppointment } from '@when/calendar';

vi.mock('@when/video-chat', () => ({
	getVideoChatAdapter: vi.fn()
}));

vi.mock('@when/calendar', () => ({
	pushAppointment: vi.fn()
}));

const mockConfig = {
	url: { app: 'https://when.example.com' },
	services: [
		{
			id: 'nc-service',
			type: 'nextcloud',
			url: 'https://cloud.example.com',
			username: 'user',
			password: 'pwd'
		},
		{
			id: 'google-service',
			type: 'google',
			client_id: 'gc-id',
			client_secret: 'gc-secret',
			refresh_token: 'gc-token'
		}
	],
	video_chats: [
		{
			id: 'my-talk',
			type: 'nextcloud-talk',
			service_id: 'nc-service'
		},
		{
			id: 'google-meet',
			type: 'google-meet',
			service_id: 'google-service'
		}
	],
	calendars: [
		{
			id: 'g-cal',
			type: 'google',
			service_id: 'google-service',
			google_calendar_id: 'primary'
		}
	],
	event_types: [
		{
			id: 'chat',
			name: 'Chat',
			destination_calendar: 'g-cal'
		}
	]
} as unknown as WhenConfiguration;

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

describe('ensureVideoChatLink', () => {
	test('no-op if video_chat is empty', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					id: 'a1',
					event_type_id: 'chat',
					start_time: '2026-05-01T15:00:00Z',
					end_time: '2026-05-01T15:30:00Z',
					guest_name: 'Booker',
					guest_email: 'booker@example.com',
					location: null,
					video_chat: null,
					status: 'confirmed',
					cancel_token: 'tok',
					origin_id: 'a1',
					calendar_revision: 1
				})
				.execute();

			const res = await ensureVideoChatLink(db, 'a1', mockConfig);
			expect(res.video_chat).toBeNull();
			expect(getVideoChatAdapter).not.toHaveBeenCalled();
			expect(pushAppointment).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});

	test('no-op if video_chat is already a URL', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					id: 'a2',
					event_type_id: 'chat',
					start_time: '2026-05-01T15:00:00Z',
					end_time: '2026-05-01T15:30:00Z',
					guest_name: 'Booker',
					guest_email: 'booker@example.com',
					location: null,
					video_chat: 'https://zoom.us/j/123',
					status: 'confirmed',
					cancel_token: 'tok',
					origin_id: 'a2',
					calendar_revision: 1
				})
				.execute();

			const res = await ensureVideoChatLink(db, 'a2', mockConfig);
			expect(res.video_chat).toBe('https://zoom.us/j/123');
			expect(getVideoChatAdapter).not.toHaveBeenCalled();
			expect(pushAppointment).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});

	test('creates Nextcloud Talk room, updates link, bumps calendar_revision', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					id: 'a3',
					event_type_id: 'chat',
					start_time: '2026-05-01T15:00:00Z',
					end_time: '2026-05-01T15:30:00Z',
					guest_name: 'Booker',
					guest_email: 'booker@example.com',
					location: null,
					video_chat: 'my-talk',
					status: 'confirmed',
					cancel_token: 'tok',
					origin_id: 'a3',
					calendar_revision: 1
				})
				.execute();

			const mockAdapter = {
				createRoom: vi
					.fn()
					.mockResolvedValue({ ok: true, url: 'https://cloud.example.com/call/abc' })
			};
			vi.mocked(getVideoChatAdapter).mockReturnValue(mockAdapter);

			const res = await ensureVideoChatLink(db, 'a3', mockConfig);

			expect(mockAdapter.createRoom).toHaveBeenCalledWith('Meeting: Booker');
			expect(res.video_chat).toBe('https://cloud.example.com/call/abc');
			expect(res.calendar_revision).toBe(2);

			const logs = parseActionLog(res.action_log);
			expect(logs.length).toBe(1);
			expect(logs[0].action).toBe('video_chat');
			expect(logs[0].payload?.metadata?.state).toBe('done');
		} finally {
			await db.destroy();
		}
	});

	test('pushes to Google Calendar for Google Meet, updates Meet link, updates sync fields', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					id: 'a4',
					event_type_id: 'chat',
					start_time: '2026-05-01T15:00:00Z',
					end_time: '2026-05-01T15:30:00Z',
					guest_name: 'Booker',
					guest_email: 'booker@example.com',
					location: null,
					video_chat: 'google-meet',
					status: 'confirmed',
					cancel_token: 'tok',
					origin_id: 'a4',
					calendar_revision: 5
				})
				.execute();

			vi.mocked(pushAppointment).mockResolvedValue({
				ok: true,
				externalEventId: 'evt-google-999',
				externalCalendarId: 'g-cal',
				videoChatUrl: 'https://meet.google.com/abc-defg-hij'
			});

			const res = await ensureVideoChatLink(db, 'a4', mockConfig);

			expect(pushAppointment).toHaveBeenCalledWith(
				mockConfig,
				expect.objectContaining({ id: 'a4' }),
				'g-cal',
				expect.objectContaining({ cancelUrl: expect.any(String) })
			);

			expect(res.video_chat).toBe('https://meet.google.com/abc-defg-hij');
			expect(res.external_event_id).toBe('evt-google-999');
			expect(res.external_calendar_id).toBe('g-cal');
			expect(res.calendar_synced_revision).toBe(5);

			const logs = parseActionLog(res.action_log);
			expect(logs).toHaveLength(2);
			expect(logs.map((l) => l.action)).toContain('video_chat');
			expect(logs.map((l) => l.action)).toContain('calendar');
		} finally {
			await db.destroy();
		}
	});
});
