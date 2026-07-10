import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import { fetchBrandLogo, clearLogoCache, BRAND_LOGO_CID } from './logo.js';

function cfg(
	appearance: Record<string, unknown> | undefined,
	internal?: string
): WhenConfiguration {
	return {
		user: { name: 'Acme', email: 'o@acme.test', timezone: 'UTC', appearance },
		url: { app: 'https://book.acme.test', internal }
	} as unknown as WhenConfiguration;
}

function imageResponse(bytes = Buffer.from([1, 2, 3]), contentType = 'image/png'): Response {
	return new Response(bytes, { status: 200, headers: { 'content-type': contentType } });
}

beforeEach(() => clearLogoCache());
afterEach(() => vi.restoreAllMocks());

describe('fetchBrandLogo', () => {
	test('returns null and never fetches when no image is configured', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		expect(
			await fetchBrandLogo(cfg({ primary_light_color: '#fff', primary_dark_color: '#fff' }))
		).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test('embeds a fetched image as a base64 CID attachment', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse(Buffer.from('PNG'), 'image/png'));
		const logo = await fetchBrandLogo(cfg({ logo_url: 'https://cdn.acme.test/logo.png' }));
		expect(logo).toEqual({
			filename: 'logo.png',
			content: Buffer.from('PNG').toString('base64'),
			contentType: 'image/png',
			cid: BRAND_LOGO_CID,
			encoding: 'base64'
		});
	});

	test('resolves a relative path against url.internal', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(imageResponse(Buffer.from('x'), 'image/jpeg'));
		await fetchBrandLogo(cfg({ logo_url: '/brand/logo.png' }, 'http://when-app:3000'));
		expect(fetchSpy).toHaveBeenCalledWith('http://when-app:3000/brand/logo.png', expect.anything());
	});

	test('falls back to url.app for relative paths when url.internal is unset', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse());
		await fetchBrandLogo(cfg({ avatar_url: '/me.png' }));
		expect(fetchSpy).toHaveBeenCalledWith('https://book.acme.test/me.png', expect.anything());
	});

	test('prefers logo_url over avatar_url', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse());
		await fetchBrandLogo(cfg({ logo_url: 'https://cdn/l.png', avatar_url: 'https://cdn/a.png' }));
		expect(fetchSpy).toHaveBeenCalledWith('https://cdn/l.png', expect.anything());
	});

	test('returns null on a non-200 response', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
		expect(await fetchBrandLogo(cfg({ logo_url: 'https://cdn/x.png' }))).toBeNull();
	});

	test('returns null when the response is not an image', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })
		);
		expect(await fetchBrandLogo(cfg({ logo_url: 'https://cdn/x.png' }))).toBeNull();
	});

	test('returns null when the fetch throws', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
		expect(await fetchBrandLogo(cfg({ logo_url: 'https://cdn/x.png' }))).toBeNull();
	});

	test('caches by URL: a second call does not refetch', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse());
		const c = cfg({ logo_url: 'https://cdn/x.png' });
		await fetchBrandLogo(c);
		await fetchBrandLogo(c);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});
