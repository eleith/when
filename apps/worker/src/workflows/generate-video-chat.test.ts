import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations, parseActionLog } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { setWorkerContext, type WorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { runGenerateVideoChat } from './generate-video-chat.js';
import { getVideoChatAdapter, type VideoChatAdapter } from '@when/video-chat';

import { sampleConfig } from '../email/__fixtures__/appointment.js';

vi.mock('@when/video-chat', () => ({
	getVideoChatAdapter: vi.fn(),
	isCalendarIntegratedVideoChat: vi.fn((p) => p.type === 'google'),
	isStandaloneVideoChat: vi.fn((p) => p.type !== 'google')
}));

const mockConfig = {
	...sampleConfig,
	url: { app: 'https://when.example.com' },
	providers: {
		'nc-service': {
			type: 'nextcloud',
			url: 'https://cloud.example.com',
			username: 'user',
			password: 'pwd',
			calendars: {}
		}
	},
	meetings: {
		chat: {
			title: 'Chat',
			booking_calendar: 'my-cal',
			video_chat: { provider: 'nc-service' }
		}
	}
} as unknown as WhenConfiguration;

import type { Mailer } from '../email/smtp.js';

let db: WorkerContext['db'];
let mailerSend = vi.fn();

describe('runGenerateVideoChat', () => {
	beforeEach(async () => {
		db = openDb(':memory:');
		await runMigrations(db);
		mailerSend = vi.fn().mockResolvedValue({ ok: true });
		const mailer: Mailer = { send: mailerSend };
		setWorkerContext({
			config: mockConfig,
			logger: createLogger(),
			db,
			mailer
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await db.destroy();
	});

	test('returns early if appointment already has an active URL', async () => {
		await db
			.insertInto('appointments')
			.values({
				id: 'app-1',
				event_type_id: 'chat',
				start_time: '2026-05-01T15:00:00Z',
				end_time: '2026-05-01T15:30:00Z',
				guest_name: 'Jane',
				guest_email: 'jane@example.com',
				guest_timezone: 'UTC',
				location: null,
				video_chat: 'https://existing.room/123',
				status: 'confirmed',
				cancel_token: 'tok',
				origin_id: 'app-1',
				calendar_revision: 1,
				ics_sequence: 0,
				has_possible_conflict: 0,
				meeting_snapshot: null,
				guest_answers: null,
				created_at: '',
				updated_at: ''
			})
			.execute();

		const result = await runGenerateVideoChat({ appointmentId: 'app-1' });
		expect(result).toEqual({ url: 'https://existing.room/123' });
		expect(getVideoChatAdapter).not.toHaveBeenCalled();
	});

	test('generates Nextcloud room, records action log, and returns url', async () => {
		await db
			.insertInto('appointments')
			.values({
				id: 'app-2',
				event_type_id: 'chat',
				start_time: '2026-05-01T15:00:00Z',
				end_time: '2026-05-01T15:30:00Z',
				guest_name: 'Jane',
				guest_email: 'jane@example.com',
				guest_timezone: 'UTC',
				location: null,
				video_chat: null,
				status: 'confirmed',
				cancel_token: 'tok',
				origin_id: 'app-2',
				calendar_revision: 1,
				ics_sequence: 0,
				has_possible_conflict: 0,
				meeting_snapshot: null,
				guest_answers: null,
				action_log: '[]',
				created_at: '',
				updated_at: ''
			})
			.execute();

		const mockAdapter = {
			createRoom: vi
				.fn()
				.mockResolvedValue({ ok: true, url: 'https://cloud.example.com/call/room-generated' }),
			deleteRoom: vi.fn()
		} as unknown as VideoChatAdapter;
		vi.mocked(getVideoChatAdapter).mockReturnValue(mockAdapter);

		const result = await runGenerateVideoChat({ appointmentId: 'app-2' });
		expect(result).toEqual({ url: 'https://cloud.example.com/call/room-generated' });

		const row = await db
			.selectFrom('appointments')
			.selectAll()
			.where('id', '=', 'app-2')
			.executeTakeFirstOrThrow();

		expect(row.video_chat).toBe('https://cloud.example.com/call/room-generated');

		const logs = parseActionLog(row.action_log);
		expect(logs.some((l) => l.action === 'edit' && l.actor === 'host')).toBe(true);
		expect(mailerSend).toHaveBeenCalledTimes(2); // guest and host email
	});

	test('throws if appointment is not found', async () => {
		await expect(runGenerateVideoChat({ appointmentId: 'missing' })).rejects.toThrow(
			'Appointment "missing" not found'
		);
	});
});
