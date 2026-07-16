import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { CalDavCalendar, Service } from '@when/config';
import { verifyCalDavConnection } from './dav.ts';

describe('verifyCalDavConnection', () => {
	const cal: CalDavCalendar = {
		name: 'work',
		type: 'caldav',
		service: 'work-service',
		url: 'https://example.com/caldav/'
	};

	const testService: Service = {
		name: 'work-service',
		type: 'caldav',
		url: 'https://example.com/caldav/',
		username: 'user',
		password: 'password'
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	test('resolves successfully on 200 OK response', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			text: async () => `
				<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
				</d:multistatus>
			`
		} as Response);

		await expect(verifyCalDavConnection(cal, testService)).resolves.toBeUndefined();
		expect(fetchSpy).toHaveBeenCalledWith(
			cal.url,
			expect.objectContaining({
				method: 'REPORT',
				headers: expect.objectContaining({
					Authorization: 'Basic dXNlcjpwYXNzd29yZA==',
					Depth: '1'
				})
			})
		);
	});

	test('throws an error on 401 Unauthorized response', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			text: async () => 'Unauthorized'
		} as Response);

		await expect(verifyCalDavConnection(cal, testService)).rejects.toThrow(
			'CalDAV REPORT https://example.com/caldav/ failed: 401 Unauthorized'
		);
	});
});
