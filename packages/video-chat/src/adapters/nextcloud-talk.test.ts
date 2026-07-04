import { describe, expect, test, vi } from 'vitest';
import { NextcloudTalkAdapter } from './nextcloud-talk.js';
import type { VideoChat, NextcloudService } from '@when/config';

describe('NextcloudTalkAdapter', () => {
	const mockVc: VideoChat = {
		id: 'my-talk',
		type: 'nextcloud-talk',
		service_id: 'my-nextcloud'
	};

	const mockService: NextcloudService = {
		id: 'my-nextcloud',
		type: 'nextcloud',
		url: 'https://cloud.example.com/',
		username: 'user',
		password: 'password'
	};

	test('createRoom success returns meeting URL', async () => {
		const adapter = new NextcloudTalkAdapter(mockVc, mockService);

		const fakeFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				ocs: {
					data: {
						token: 'room-token-123'
					}
				}
			})
		});

		const result = await adapter.createRoom('Meeting: Alice', { fetchImpl: fakeFetch });

		expect(result).toEqual({
			ok: true,
			url: 'https://cloud.example.com/call/room-token-123'
		});

		expect(fakeFetch).toHaveBeenCalledWith(
			'https://cloud.example.com/ocs/v2.php/apps/spreed/api/v4/room',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					'OCS-APIRequest': 'true',
					'Accept': 'application/json',
					'Content-Type': 'application/json',
					'Authorization': expect.stringContaining('Basic')
				}),
				body: JSON.stringify({
					roomType: 3,
					roomName: 'Meeting: Alice'
				})
			})
		);
	});

	test('createRoom failure returns error reason', async () => {
		const adapter = new NextcloudTalkAdapter(mockVc, mockService);

		const fakeFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => 'Internal Server Error'
		});

		const result = await adapter.createRoom('Meeting: Alice', { fetchImpl: fakeFetch });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('status 500');
			expect(result.reason).toContain('Internal Server Error');
		}
	});
});
