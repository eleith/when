import { describe, expect, test, vi, beforeEach } from 'vitest';
import { getVideoChatAdapter, NextcloudTalkAdapter, nextcloudRoomToken } from '../index.js';
import type { NextcloudProvider } from '@when/config';

describe('NextcloudTalkAdapter', () => {
	const mockService: NextcloudProvider = {
		type: 'nextcloud',
		url: 'https://cloud.example.com/',
		username: 'user',
		password: 'password',
		calendars: {}
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	test('room identity follows normalized origin and decoded installation/call/token segments', () => {
		const provider = { url: 'https://CLOUD.example.com:443/next%63loud/' };
		const canonical = nextcloudRoomToken(
			provider,
			'https://cloud.example.com/nextcloud/call/room_123'
		);
		const alias = nextcloudRoomToken(
			provider,
			'https://CLOUD.example.com:443/next%63loud/%63all/room_%3123?view=guest#call'
		);

		const userinfoAlias = nextcloudRoomToken(
			provider,
			'https://guest:shared@cloud.example.com/nextcloud/call/room_123'
		);

		expect(canonical).toBe('room_123');
		expect(alias).toBe(canonical);
		expect(userinfoAlias).toBe(canonical);
	});

	test.each([
		'https://other.example.com/nextcloud/call/room_123',
		'https://cloud.example.com/call/room_123',
		'https://cloud.example.com/nextcloud/call/room%2F123',
		'https://cloud.example.com/nextcloud/call/room%5C123',
		'https://cloud.example.com/nextcloud%2Fcall/room_123',
		'https://cloud.example.com/nextcloud/call/room%ZZ'
	])('rejects a different or invalid resource identity: %s', (url) => {
		const token = nextcloudRoomToken({ url: 'https://cloud.example.com/nextcloud/' }, url);
		expect(token).toBeNull();
	});

	test('same token on another origin never deletes a room on the configured server', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			throw new Error(`Unexpected fetch: ${String(url)}`);
		});
		const adapter = new NextcloudTalkAdapter(mockService);

		const result = await adapter.removeLink(
			'https://guest:secret@other.example.com/call/room-token-123?password=private'
		);

		expect(result).toEqual({ ok: false, reason: 'Invalid Nextcloud room identity' });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test('creates and deletes the actual room beneath an installation path', async () => {
		const provider = { ...mockService, url: 'https://cloud.example.com/nextcloud/' };
		const endpoint = 'https://cloud.example.com/nextcloud/ocs/v2.php/apps/spreed/api/v4/room';
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
			if (String(url) === endpoint && init?.method === 'POST') {
				return new Response(JSON.stringify({ ocs: { data: { token: 'room_123' } } }));
			}
			if (String(url) === `${endpoint}/room_123` && init?.method === 'DELETE') {
				return new Response(null, { status: 204 });
			}
			throw new Error(`Unexpected fetch: ${String(url)}`);
		});
		const adapter = new NextcloudTalkAdapter(provider);

		const created = await adapter.request({ name: 'Meeting', requestId: 'booking-id' });
		const deleted = await adapter.removeLink(
			'https://guest:shared@CLOUD.example.com:443/next%63loud/%63all/room_%3123?view=guest#call'
		);

		expect(created).toEqual({
			ok: true,
			status: 'ready',
			url: 'https://cloud.example.com/nextcloud/call/room_123'
		});
		expect(deleted).toEqual({ ok: true });
		expect(JSON.parse(JSON.stringify([created, deleted]))).toEqual([created, deleted]);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	test('creation rejects a token that would not identify one safe room path segment', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
			if (
				String(url) !== 'https://cloud.example.com/ocs/v2.php/apps/spreed/api/v4/room' ||
				init?.method !== 'POST'
			) {
				throw new Error(`Unexpected fetch: ${String(url)}`);
			}
			return new Response(JSON.stringify({ ocs: { data: { token: 'room/other' } } }));
		});
		const adapter = new NextcloudTalkAdapter(mockService);

		const result = await adapter.request({ name: 'Meeting', requestId: 'booking-id' });

		expect(result.ok).toBe(false);
	});

	test('request success returns meeting URL', async () => {
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

		const result = await adapter.request({ name: 'Meeting: Alice', requestId: 'booking-id' });

		expect(result).toEqual({
			ok: true,
			status: 'ready',
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

	test('request failure returns error reason', async () => {
		const adapter = new NextcloudTalkAdapter(mockService);

		vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => 'Internal Server Error'
		} as Response);

		const result = await adapter.request({ name: 'Meeting: Alice', requestId: 'booking-id' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('status 500');
			expect(result.reason).toContain('Internal Server Error');
		}
	});

	test('a null pointer is known absence and removal needs no I/O', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		const adapter = new NextcloudTalkAdapter(mockService);

		const read = await adapter.read(null);
		const removed = await adapter.removeLink(null);

		expect(read).toEqual({ ok: true, status: 'absent' });
		expect(removed).toEqual({ ok: true });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test('reads the validated room with configured credentials and returns its canonical URL', async () => {
		const adapter = new NextcloudTalkAdapter({
			...mockService,
			url: 'https://cloud.example.com/nextcloud/'
		});
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(JSON.stringify({ ocs: { data: { token: 'room_123' } } })));

		const result = await adapter.read(
			'https://guest:shared@CLOUD.example.com:443/next%63loud/%63all/room_%3123?view=guest#call'
		);

		expect(result).toEqual({
			ok: true,
			status: 'ready',
			url: 'https://cloud.example.com/nextcloud/call/room_123'
		});
		expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
			'https://cloud.example.com/nextcloud/ocs/v2.php/apps/spreed/api/v4/room/room_123',
			{
				method: 'GET',
				signal: undefined,
				headers: {
					'OCS-APIRequest': 'true',
					Accept: 'application/json',
					Authorization: `Basic ${Buffer.from('user:password').toString('base64')}`
				}
			}
		);
	});

	test.each([404, 401, 403, 500])('read HTTP %s is not evidence of absence', async (status) => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response('private server details', { status }));
		const adapter = new NextcloudTalkAdapter(mockService);

		const result = await adapter.read('https://cloud.example.com/call/room_123');

		expect(result).toEqual({
			ok: false,
			reason: `Nextcloud Talk room read returned status ${status}`
		});
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	test.each([
		'https://guest:secret@other.example.com/call/room_123?password=private',
		'https://cloud.example.com/call/room%2F123'
	])('read rejects invalid identity without I/O: %s', async (url) => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		const adapter = new NextcloudTalkAdapter(mockService);

		const result = await adapter.read(url);

		expect(result).toEqual({ ok: false, reason: 'Invalid Nextcloud room identity' });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test.each([
		'not JSON',
		'null',
		'{}',
		JSON.stringify({ ocs: { data: { token: 'room/123' } } }),
		JSON.stringify({ ocs: { data: { token: 'different_room' } } })
	])('read does not treat malformed or mismatched data as absence: %s', async (body) => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
		const adapter = new NextcloudTalkAdapter(mockService);

		const result = await adapter.read('https://cloud.example.com/call/room_123');

		expect(result).toEqual({ ok: true, status: 'ambiguous' });
	});

	test('read transport failure returns a controlled reason', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private transport details'));
		const adapter = new NextcloudTalkAdapter(mockService);

		const result = await adapter.read('https://cloud.example.com/call/room_123');

		expect(result).toEqual({ ok: false, reason: 'Nextcloud Talk room read failed' });
	});

	test('read body transport failure is not a successful observation', async () => {
		const response = new Response('{}');
		vi.spyOn(response, 'text').mockRejectedValue(new TypeError('private body read details'));
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
		const adapter = new NextcloudTalkAdapter(mockService);

		const result = await adapter.read('https://cloud.example.com/call/room_123');

		expect(result).toEqual({ ok: false, reason: 'Nextcloud Talk room read failed' });
	});

	test('removeLink success returns ok', async () => {
		const adapter = new NextcloudTalkAdapter(mockService);

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true
		} as Response);

		const result = await adapter.removeLink('https://cloud.example.com/call/room-token-123');

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

	test('removeLink failure returns error reason', async () => {
		const adapter = new NextcloudTalkAdapter(mockService);

		vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: false,
			status: 404,
			text: async () => 'Not Found'
		} as Response);

		const result = await adapter.removeLink('https://cloud.example.com/call/room-token-123');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('status 404');
			expect(result.reason).toContain('Not Found');
		}
	});

	test.each([false, true])(
		'one adapter forwards its optional caller signal to create/read/remove (caller=%s), without deadlines',
		async (withSignal) => {
			const timeout = vi.spyOn(AbortSignal, 'timeout');
			const signal = withSignal ? new AbortController().signal : undefined;
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
				if (init?.method === 'DELETE') return new Response(null, { status: 204 });
				return new Response(JSON.stringify({ ocs: { data: { token: 'room_123' } } }));
			});
			const adapter = getVideoChatAdapter(mockService, null, signal);
			const roomUrl = 'https://cloud.example.com/call/room_123';

			const created = await adapter.request({ name: 'Meeting', requestId: 'uuid' });
			const read = await adapter.read(roomUrl);
			const removed = await adapter.removeLink(roomUrl);

			expect(created).toEqual({ ok: true, status: 'ready', url: roomUrl });
			expect(read).toEqual(created);
			expect(removed).toEqual({ ok: true });
			expect(fetchSpy.mock.calls.map(([, init]) => init?.method)).toEqual([
				'POST',
				'GET',
				'DELETE'
			]);
			for (const [, init] of fetchSpy.mock.calls) {
				expect(init?.signal).toBe(signal);
			}
			expect(timeout).not.toHaveBeenCalled();
		}
	);

	test.each(['POST', 'GET', 'DELETE'] as const)(
		'%s controls caller cancellation through the existing adapter catch',
		async (method) => {
			const controller = new AbortController();
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
				expect(init?.signal).toBe(controller.signal);
				const response = new Promise<Response>((_resolve, reject) => {
					controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
						once: true
					});
				});
				controller.abort(new DOMException('Caller cancelled', 'AbortError'));
				return response;
			});
			const adapter = new NextcloudTalkAdapter(mockService, controller.signal);
			let result: { ok: boolean; reason?: string };
			if (method === 'POST') {
				result = await adapter.request({ name: 'Meeting', requestId: 'uuid' });
			} else if (method === 'GET') {
				result = await adapter.read('https://cloud.example.com/call/room_123');
			} else {
				result = await adapter.removeLink('https://cloud.example.com/call/room_123');
			}
			expect(result).toEqual({
				ok: false,
				reason: method === 'GET' ? 'Nextcloud Talk room read failed' : 'Caller cancelled'
			});
			expect(fetchSpy).toHaveBeenCalledTimes(1);
		}
	);

	test('removeLink with invalid URL returns error', async () => {
		const adapter = new NextcloudTalkAdapter(mockService);
		const result = await adapter.removeLink('https://cloud.example.com/invalid-path');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('Invalid Nextcloud room identity');
		}
	});
});
