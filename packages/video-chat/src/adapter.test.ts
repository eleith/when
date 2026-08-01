import { describe, expect, test } from 'vitest';
import { getVideoChatAdapter } from './adapter.js';
import type { WhenConfiguration } from '@when/config';

describe('getVideoChatAdapter', () => {
	const mockConfig: WhenConfiguration = {
		providers: [
			{
				name: 'nc-service',
				type: 'nextcloud',
				url: 'https://cloud.example.com',
				username: 'user',
				password: 'pwd'
			},
			{
				name: 'google-service',
				type: 'google',
				client_id: 'gc-id',
				client_secret: 'gc-secret'
			}
		],
		calendars: [],
		schedules: [],
		meetings: [],
		auth: { credentials: { username: 'admin', password: 'pwd' } },
		user: { name: 'J', timezone: 'UTC', email: 'j@example.com' },
		smtp: { host: 'smtp', port: 25, user: 'u', pass: 'p' }
	} as unknown as WhenConfiguration;

	test('returns NextcloudTalkAdapter for nextcloud service', () => {
		const srv = mockConfig.providers![0];
		const adapter = getVideoChatAdapter(srv);
		expect(adapter).toBeDefined();
		expect(adapter.constructor.name).toBe('NextcloudTalkAdapter');
	});

	test('returns native meet adapter for google service', () => {
		const srv = mockConfig.providers![1];
		const adapter = getVideoChatAdapter(srv);
		expect(adapter).toBeDefined();
		expect(adapter.constructor.name).toBe('GoogleMeetAdapter');
	});

	test('throws for unsupported service type', () => {
		const srv = {
			name: 'broken-service',
			type: 'caldav' as const,
			url: 'https://cal.example.com',
			username: 'u',
			password: 'p'
		};
		expect(() => getVideoChatAdapter(srv)).toThrow('Unsupported video chat provider type: caldav');
	});
});
