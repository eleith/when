import { describe, expect, test } from 'vitest';
import { getVideoChatAdapter } from './adapter.js';
import type { WhenConfiguration } from '@when/config';

describe('getVideoChatAdapter', () => {
	const mockConfig: WhenConfiguration = {
		providers: {
			'nc-service': {
				type: 'nextcloud',
				url: 'https://cloud.example.com',
				username: 'user',
				password: 'pwd',
				calendars: {}
			},
			'google-service': {
				type: 'google',
				client_id: 'gc-id',
				client_secret: 'gc-secret',
				calendars: {}
			}
		},
		schedules: {},
		meetings: {},
		auth: { credentials: { username: 'admin', password: 'pwd' } },
		user: { name: 'J', timezone: 'UTC', email: 'j@example.com' },
		smtp: { host: 'smtp', port: 25, user: 'u', pass: 'p' }
	} as unknown as WhenConfiguration;

	test('returns NextcloudTalkAdapter for nextcloud service', () => {
		const srv = mockConfig.providers['nc-service'];
		const adapter = getVideoChatAdapter(srv);
		expect(adapter).toBeDefined();
		expect(adapter.constructor.name).toBe('NextcloudTalkAdapter');
	});

	test('returns native meet adapter for google service', () => {
		const srv = mockConfig.providers['google-service'];
		const adapter = getVideoChatAdapter(srv);
		expect(adapter).toBeDefined();
		expect(adapter.constructor.name).toBe('GoogleMeetAdapter');
	});

	test('throws for unsupported service type', () => {
		const srv = {
			type: 'caldav' as const,
			url: 'https://cal.example.com',
			username: 'u',
			password: 'p',
			calendars: {}
		};
		expect(() => getVideoChatAdapter(srv)).toThrow('Unsupported video chat provider type: caldav');
	});
});
