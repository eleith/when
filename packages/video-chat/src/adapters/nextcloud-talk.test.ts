import { describe, expect, test, vi, beforeEach } from 'vitest';
import { NextcloudTalkAdapter } from './nextcloud-talk.js';
import type { NextcloudService } from '@when/config';

describe('NextcloudTalkAdapter', () => {
	const mockService: NextcloudService = {
		name: 'my-nextcloud',
		type: 'nextcloud',
		url: 'https://cloud.example.com/',
		username: 'user',
		password: 'password'
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	test('createRoom success returns meeting URL', async () => {
		const adapter = new NextcloudTalkAdapter(mockService);

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			json: async () => ({
				ocs: {
					data: {
						token: 'room-token-123'
					}
				}
			})
		} as Response);

		const result = await adapter.createRoom('Meeting: Alice');

		expect(result).toEqual({
			ok: true,
			url: 'https://cloud.example.com/call/room-token-123'
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			'https://cloud.example.com/ocs/v2.php/apps/spreed/api/v4/room',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					'OCS-APIRequest': 'true',
					Accept: 'application/json',
					'Content-Type': 'application/json',
					Authorization: expect.stringContaining('Basic')
				}),
				body: JSON.stringify({
					roomType: 3,
					roomName: 'Meeting: Alice'
				})
			})
		);
	});

	test('createRoom failure returns error reason', async () => {
		const adapter = new NextcloudTalkAdapter(mockService);

		vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => 'Internal Server Error'
		} as Response);

		const result = await adapter.createRoom('Meeting: Alice');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('status 500');
			expect(result.reason).toContain('Internal Server Error');
		}
	});

	test('deleteRoom success returns ok', async () => {
		const adapter = new NextcloudTalkAdapter(mockService);

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true
		} as Response);

		const result = await adapter.deleteRoom('https://cloud.example.com/call/room-token-123');

		expect(result).toEqual({ ok: true });

		expect(fetchSpy).toHaveBeenCalledWith(
			'https://cloud.example.com/ocs/v2.php/apps/spreed/api/v4/room/room-token-123',
			expect.objectContaining({
				method: 'DELETE',
				headers: expect.objectContaining({
					'OCS-APIRequest': 'true',
					Accept: 'application/json',
					'Content-Type': 'application/json',
					Authorization: expect.stringContaining('Basic')
				})
			})
		);
	});

	test('deleteRoom failure returns error reason', async () => {
		const adapter = new NextcloudTalkAdapter(mockService);

		vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: false,
			status: 404,
			text: async () => 'Not Found'
		} as Response);

		const result = await adapter.deleteRoom('https://cloud.example.com/call/room-token-123');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('status 404');
			expect(result.reason).toContain('Not Found');
		}
	});

	test('deleteRoom with invalid URL returns error', async () => {
		const adapter = new NextcloudTalkAdapter(mockService);
		const result = await adapter.deleteRoom('https://cloud.example.com/invalid-path');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('Invalid room URL format');
		}
	});
});
