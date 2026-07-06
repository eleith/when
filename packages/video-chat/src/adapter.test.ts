import { describe, expect, test } from 'vitest';
import { getVideoChatAdapter } from './adapter.js';
import type { WhenConfiguration } from '@when/config';

describe('getVideoChatAdapter', () => {
	const mockConfig: WhenConfiguration = {
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
				id: 'my-meet',
				type: 'google-meet',
				service_id: 'google-service'
			}
		],
		calendars: [],
		availability: { default: {} },
		event_types: [],
		auth: { credentials: { username: 'admin', password: 'pwd' } },
		user: { name: 'J', timezone: 'UTC', email: 'j@example.com' },
		smtp: { host: 'smtp', port: 25, user: 'u', pass: 'p' }
	} as unknown as WhenConfiguration;

	test('returns NextcloudTalkAdapter for nextcloud-talk', () => {
		const vc = mockConfig.video_chats![0];
		const adapter = getVideoChatAdapter(vc, mockConfig);
		expect(adapter).toBeDefined();
		expect(adapter.constructor.name).toBe('NextcloudTalkAdapter');
	});

	test('returns native meet adapter for google-meet', () => {
		const vc = mockConfig.video_chats![1];
		const adapter = getVideoChatAdapter(vc, mockConfig);
		expect(adapter).toBeDefined();
	});

	test('throws for unknown service referenced', () => {
		const vc = {
			id: 'broken-talk',
			type: 'nextcloud-talk' as const,
			service_id: 'missing-service'
		};
		expect(() => getVideoChatAdapter(vc, mockConfig)).toThrow(
			'Service "missing-service" not found'
		);
	});
});
