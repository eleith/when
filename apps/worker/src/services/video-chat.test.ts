import { describe, expect, test, vi, beforeEach } from 'vitest';
import { openDb, runMigrations, parseActionLog } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { createStandaloneVideoChat, deleteStandaloneVideoChat } from './video-chat.js';
import { getVideoChatAdapter, type VideoChatAdapter } from '@when/video-chat';

vi.mock('@when/video-chat', () => ({
	getVideoChatAdapter: vi.fn()
}));

beforeEach(() => {
	vi.clearAllMocks();
});

const mockConfig = {
	url: { app: 'https://when.example.com' },
	services: [
		{
			name: 'nc-service',
			type: 'nextcloud',
			url: 'https://cloud.example.com',
			username: 'user',
			password: 'pwd'
		}
	],
	calendars: [],
	meetings: [
		{
			name: 'chat',
			slug: 'chat',
			video_chat_service: 'nc-service'
		}
	]
} as unknown as WhenConfiguration;

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

describe('createStandaloneVideoChat', () => {
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
					guest_timezone: 'UTC',
					location: null,
					video_chat: null,
					status: 'confirmed',
					cancel_token: 'tok',
					origin_id: 'a1',
					calendar_revision: 1,
					ics_sequence: 0,
					has_possible_conflict: 0,
					meeting_snapshot: null,
					guest_answers: null,
					created_at: '',
					updated_at: ''
				})
				.execute();

			const res = await createStandaloneVideoChat(db, 'a1', mockConfig);
			expect(res.video_chat).toBeNull();
			expect(getVideoChatAdapter).not.toHaveBeenCalled();
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
					guest_timezone: 'UTC',
					location: null,
					video_chat: 'https://zoom.us/j/123',
					status: 'confirmed',
					cancel_token: 'tok',
					origin_id: 'a2',
					calendar_revision: 1,
					ics_sequence: 0,
					has_possible_conflict: 0,
					meeting_snapshot: null,
					guest_answers: null,
					created_at: '',
					updated_at: ''
				})
				.execute();

			const res = await createStandaloneVideoChat(db, 'a2', mockConfig);
			expect(res.video_chat).toBe('https://zoom.us/j/123');
			expect(getVideoChatAdapter).not.toHaveBeenCalled();
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
					guest_timezone: 'UTC',
					location: null,
					video_chat: 'nextcloud-talk',
					status: 'confirmed',
					cancel_token: 'tok',
					origin_id: 'a3',
					calendar_revision: 1,
					ics_sequence: 0,
					has_possible_conflict: 0,
					meeting_snapshot: null,
					guest_answers: null,
					created_at: '',
					updated_at: ''
				})
				.execute();

			const mockAdapter = {
				createRoom: vi
					.fn()
					.mockResolvedValue({ ok: true, url: 'https://cloud.example.com/call/abc' }),
				deleteRoom: vi.fn()
			} as unknown as VideoChatAdapter;
			vi.mocked(getVideoChatAdapter).mockReturnValue(mockAdapter);

			const res = await createStandaloneVideoChat(db, 'a3', mockConfig);

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
});

describe('deleteStandaloneVideoChat', () => {
	test('no-op if video_chat does not start with http', async () => {
		const db = await makeDb();
		try {
			await db
				.insertInto('appointments')
				.values({
					id: 'c1',
					event_type_id: 'chat',
					start_time: '2026-05-01T15:00:00Z',
					end_time: '2026-05-01T15:30:00Z',
					guest_name: 'Booker',
					guest_email: 'booker@example.com',
					guest_timezone: 'UTC',
					location: null,
					video_chat: 'nextcloud-talk',
					status: 'cancelled',
					cancel_token: 'tok',
					origin_id: 'c1',
					calendar_revision: 1,
					ics_sequence: 0,
					has_possible_conflict: 0,
					meeting_snapshot: null,
					guest_answers: null,
					created_at: '',
					updated_at: ''
				})
				.execute();

			await deleteStandaloneVideoChat(db, 'c1', mockConfig);

			const row = await db
				.selectFrom('appointments')
				.selectAll()
				.where('id', '=', 'c1')
				.executeTakeFirstOrThrow();
			expect(row.video_chat).toBe('nextcloud-talk');
			expect(getVideoChatAdapter).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});

	test('deletes Nextcloud Talk room, sets video_chat to null', async () => {
		const db = await makeDb();
		try {
			const configWithVc = {
				...mockConfig,
				meetings: [
					{
						name: 'chat',
						slug: 'chat',
						booking_calendar: 'g-cal',
						video_chat_service: 'nc-service'
					}
				]
			} as unknown as WhenConfiguration;

			await db
				.insertInto('appointments')
				.values({
					id: 'c2',
					event_type_id: 'chat',
					start_time: '2026-05-01T15:00:00Z',
					end_time: '2026-05-01T15:30:00Z',
					guest_name: 'Booker',
					guest_email: 'booker@example.com',
					guest_timezone: 'UTC',
					location: null,
					video_chat: 'https://cloud.example.com/call/room-abc',
					status: 'cancelled',
					cancel_token: 'tok',
					origin_id: 'c2',
					calendar_revision: 1,
					ics_sequence: 0,
					has_possible_conflict: 0,
					meeting_snapshot: null,
					guest_answers: null,
					created_at: '',
					updated_at: ''
				})
				.execute();

			const mockAdapter = {
				createRoom: vi.fn(),
				deleteRoom: vi.fn().mockResolvedValue({ ok: true })
			} as unknown as VideoChatAdapter;
			vi.mocked(getVideoChatAdapter).mockReturnValue(mockAdapter);

			await deleteStandaloneVideoChat(db, 'c2', configWithVc);

			expect(getVideoChatAdapter).toHaveBeenCalledWith(
				mockConfig.services[0]
			);
			expect(mockAdapter.deleteRoom).toHaveBeenCalledWith(
				'https://cloud.example.com/call/room-abc'
			);

			const row = await db
				.selectFrom('appointments')
				.selectAll()
				.where('id', '=', 'c2')
				.executeTakeFirstOrThrow();
			expect(row.video_chat).toBeNull();
		} finally {
			await db.destroy();
		}
	});
});
