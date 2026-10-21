import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	getVideoChatAdapter,
	isCalendarIntegratedVideoChat,
	isStandaloneVideoChat,
	type GoogleEventPort,
	type VideoChatAdapter
} from './index.js';
import type { GoogleProvider, NextcloudProvider, Provider } from '@when/config';

const nextcloud: NextcloudProvider = {
	type: 'nextcloud',
	url: 'https://cloud.example.com',
	username: 'user',
	password: 'pwd',
	calendars: {}
};

const google: GoogleProvider = {
	type: 'google',
	client_id: 'client',
	client_secret: 'secret',
	refresh_token: '',
	calendars: {}
};

async function exerciseAdapter(adapter: VideoChatAdapter) {
	const before = await adapter.read(null);
	const requested = await adapter.request({ name: 'Booking', requestId: 'logical-request-id' });
	if (!requested.ok || requested.status !== 'ready') throw new Error('Expected ready');
	const observed = await adapter.read(requested.url);
	const removed = await adapter.removeLink(requested.url);
	return { before, requested, observed, removed };
}

afterEach(() => vi.restoreAllMocks());

describe('getVideoChatAdapter', () => {
	test('selects from config and supports one shared consumer for both providers', async () => {
		const googleUrl = 'https://meet.google.com/abc-defg-hij';
		const ready = {
			id: 'booked-event',
			conferenceData: { entryPoints: [{ entryPointType: 'video', uri: googleUrl }] }
		};
		const event: GoogleEventPort = {
			id: 'booked-event',
			read: vi.fn().mockResolvedValueOnce({ id: 'booked-event' }).mockResolvedValueOnce(ready),
			patch: vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce({ id: 'booked-event' })
		};
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response(JSON.stringify({ ocs: { data: { token: 'room_123' } } })))
			.mockResolvedValueOnce(new Response(JSON.stringify({ ocs: { data: { token: 'room_123' } } })))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));

		const googleResult = await exerciseAdapter(getVideoChatAdapter(google, event));
		const nextcloudResult = await exerciseAdapter(getVideoChatAdapter(nextcloud));

		for (const [result, url] of [
			[googleResult, googleUrl],
			[nextcloudResult, 'https://cloud.example.com/call/room_123']
		] as const) {
			expect(result).toEqual({
				before: { ok: true, status: 'absent' },
				requested: { ok: true, status: 'ready', url },
				observed: { ok: true, status: 'ready', url },
				removed: { ok: true }
			});
		}
		expect(event.read).toHaveBeenCalledTimes(2);
		expect(event.patch).toHaveBeenCalledTimes(2);
		expect(fetchSpy).toHaveBeenCalledTimes(3);
	});

	test('rejects Google construction without a booked event', () => {
		expect(() => getVideoChatAdapter(google)).toThrow(
			'Google Meet requires an already-booked event'
		);
		expect(() => getVideoChatAdapter(google, null)).toThrow(
			'Google Meet requires an already-booked event'
		);
	});

	test('legacy classification only labels Nextcloud as standalone', () => {
		const caldav: Provider = {
			type: 'caldav',
			url: 'https://calendar.example.com',
			username: 'user',
			password: 'password',
			calendars: {}
		};
		expect(() => getVideoChatAdapter(caldav)).toThrow('CalDAV does not support video chat');
		expect(isCalendarIntegratedVideoChat(nextcloud)).toBe(false);
		expect(isStandaloneVideoChat(nextcloud)).toBe(true);
		expect(isCalendarIntegratedVideoChat(google)).toBe(true);
		expect(isStandaloneVideoChat(google)).toBe(false);
		expect(isCalendarIntegratedVideoChat(caldav)).toBe(false);
		expect(isStandaloneVideoChat(caldav)).toBe(false);
	});
});
