import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { Renderer } from 'takumi-js/node';
import { defaultAvatar } from './avatar';

test('renders a deterministic svg from a seed', () => {
	expect(defaultAvatar('Jane Doe').startsWith('<svg')).toBe(true);
	expect(defaultAvatar('Jane Doe')).toBe(defaultAvatar('Jane Doe'));
});

test('produces different avatars for different seeds', () => {
	expect(defaultAvatar('Alice')).not.toBe(defaultAvatar('Bob'));
});

test('applies brand background and text colors', () => {
	const svg = defaultAvatar('Jane Doe', { backgroundColor: '#166534', textColor: '#ededed' });
	expect(svg).toContain('#166534');
	expect(svg).toContain('#ededed');
});

describe('thumbnails', () => {
	const fixtureRenderer = new Renderer();
	let sources: Record<string, Buffer>;
	let getAvatarThumbnail: typeof import('./avatar').getAvatarThumbnail;

	beforeAll(async () => {
		const node = {
			type: 'container' as const,
			style: {
				width: 800,
				height: 800,
				backgroundImage: 'linear-gradient(45deg, #166534, #34d399, #2563eb)'
			}
		};
		sources = {};
		for (const format of ['png', 'jpeg', 'webp'] as const) {
			sources[`image/${format}`] = await fixtureRenderer.render(node, {
				width: 800,
				height: 800,
				format
			});
		}
	});

	beforeEach(async () => {
		vi.resetModules();
		({ getAvatarThumbnail } = await import('./avatar'));
	});

	function sourceFetch(bytes: Uint8Array, contentType: string, etag?: string) {
		return vi.fn<typeof fetch>().mockImplementation(async () => {
			const headers = new Headers({ 'content-type': contentType });
			if (etag) headers.set('etag', etag);
			return new Response(Uint8Array.from(bytes), { headers });
		});
	}

	async function dimensions(bytes: Uint8Array) {
		const png = await fixtureRenderer.render({ type: 'image', src: bytes }, { format: 'png' });
		return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
	}

	test.each(['image/png', 'image/jpeg', 'image/webp'])(
		'resizes %s to a smaller 216px WebP',
		async (type) => {
			const source = sources[type];
			const image = await getAvatarThumbnail(sourceFetch(source, type), '/public/avatar');
			expect(image.contentType).toBe('image/webp');
			expect(image.bytes.byteLength).toBeLessThan(source.byteLength);
			expect(await dimensions(image.bytes)).toEqual({ width: 216, height: 216 });
		}
	);

	test('infers MIME from the configured filename when dev fetch omits its headers', async () => {
		const fetchSource = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(Uint8Array.from(sources['image/webp'])));
		const image = await getAvatarThumbnail(fetchSource, '/public/avatar.webp?revision=2');
		expect(image.contentType).toBe('image/webp');
		expect(image.bytes.byteLength).toBeLessThan(sources['image/webp'].byteLength);
		expect(await dimensions(image.bytes)).toEqual({ width: 216, height: 216 });
	});

	test('does not override an explicit non-image source type based on its filename', async () => {
		const fetchSource = sourceFetch(Buffer.from('not an image'), 'text/html');
		await expect(getAvatarThumbnail(fetchSource, '/public/avatar.png')).rejects.toThrow(
			'not an image'
		);
	});

	test('SVG avatars remain vectors with unchanged bytes', async () => {
		const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"/>');
		const image = await getAvatarThumbnail(sourceFetch(svg, 'image/svg+xml'), '/public/avatar.svg');
		expect(image.contentType).toBe('image/svg+xml');
		expect(Buffer.from(image.bytes)).toEqual(svg);
	});

	test('does not enlarge a small image', async () => {
		const bytes = await fixtureRenderer.render(
			{ type: 'container', style: { width: 40, height: 40, backgroundColor: 'green' } },
			{ width: 40, height: 40, format: 'png' }
		);
		const image = await getAvatarThumbnail(sourceFetch(bytes, 'image/png'), '/public/avatar.png');
		expect(image.contentType).toBe('image/png');
		expect(Buffer.from(image.bytes)).toEqual(bytes);
	});

	test('retains a large source if encoding it would increase its bytes', async () => {
		// A flat 800px lossless WebP is already smaller than the lossy thumbnail.
		const source = await fixtureRenderer.render(
			{ type: 'container', style: { width: 800, height: 800, backgroundColor: 'transparent' } },
			{ width: 800, height: 800, format: 'webp', lossless: true }
		);
		const image = await getAvatarThumbnail(
			sourceFetch(source, 'image/webp'),
			'/public/avatar.webp'
		);
		expect(Buffer.from(image.bytes)).toEqual(source);
	});

	test.each(['image/gif', 'image/avif', 'image/png'])(
		'serves original %s bytes if not decodable',
		async (type) => {
			const bytes = Buffer.from('not a decodable image');
			const image = await getAvatarThumbnail(sourceFetch(bytes, type), '/public/avatar');
			expect(image.contentType).toBe(type);
			expect(Buffer.from(image.bytes)).toEqual(bytes);
		}
	);

	test('reuses the derivative when source validation returns 304', async () => {
		const fetchSource = sourceFetch(sources['image/png'], 'image/png', '"source-v1"');
		const first = await getAvatarThumbnail(fetchSource, '/public/avatar.png');
		fetchSource.mockResolvedValueOnce(new Response(null, { status: 304 }));
		const second = await getAvatarThumbnail(fetchSource, '/public/avatar.png');
		expect(second).toBe(first);
		const options = fetchSource.mock.calls[1][1];
		expect(new Headers(options?.headers).get('if-none-match')).toBe('"source-v1"');
		expect(new Headers(options?.headers).get('accept-encoding')).toBe('identity');
		expect(options?.redirect).toBe('error');
	});

	test('concurrent requests share the source fetch and resize', async () => {
		const fetchSource = sourceFetch(sources['image/png'], 'image/png');
		const [first, second] = await Promise.all([
			getAvatarThumbnail(fetchSource, '/public/avatar.png'),
			getAvatarThumbnail(fetchSource, '/public/avatar.png')
		]);
		expect(second).toBe(first);
		expect(fetchSource).toHaveBeenCalledOnce();
	});

	test('revalidates between requests but reuses unchanged bytes without validators', async () => {
		const fetchSource = sourceFetch(sources['image/png'], 'image/png');
		const first = await getAvatarThumbnail(fetchSource, '/public/avatar.png');
		const second = await getAvatarThumbnail(fetchSource, '/public/avatar.png');
		expect(second).toBe(first);
		expect(fetchSource).toHaveBeenCalledTimes(2);
	});

	test('concurrent source failures are shared and a later request can retry', async () => {
		const fetchSource = sourceFetch(sources['image/png'], 'image/png');
		fetchSource.mockResolvedValueOnce(new Response(null, { status: 404 }));
		const attempts = await Promise.allSettled([
			getAvatarThumbnail(fetchSource, '/public/avatar.png'),
			getAvatarThumbnail(fetchSource, '/public/avatar.png')
		]);
		expect(attempts.map((attempt) => attempt.status)).toEqual(['rejected', 'rejected']);
		expect(fetchSource).toHaveBeenCalledOnce();
		await expect(getAvatarThumbnail(fetchSource, '/public/avatar.png')).resolves.toHaveProperty(
			'bytes'
		);
		expect(fetchSource).toHaveBeenCalledTimes(2);
	});

	test('refuses ambiguous compressed bytes when a source ignores identity encoding', async () => {
		const fetchSource = sourceFetch(sources['image/png'], 'image/png');
		fetchSource.mockResolvedValueOnce(
			new Response(Uint8Array.from(sources['image/png']), {
				headers: { 'content-type': 'image/png', 'content-encoding': 'gzip' }
			})
		);
		await expect(getAvatarThumbnail(fetchSource, '/public/avatar.png')).rejects.toThrow(
			'identity encoding'
		);
	});

	test('replaces the cached derivative when the source changes at the same path', async () => {
		const fetchSource = sourceFetch(sources['image/png'], 'image/png', '"source-v1"');
		const first = await getAvatarThumbnail(fetchSource, '/public/avatar.png');
		const changed = await fixtureRenderer.render(
			{ type: 'container', style: { width: 800, height: 800, backgroundColor: 'blue' } },
			{ width: 800, height: 800, format: 'png' }
		);
		fetchSource.mockImplementation(sourceFetch(changed, 'image/png', '"source-v2"'));
		const second = await getAvatarThumbnail(fetchSource, '/public/avatar.png');
		expect(second.etag).not.toBe(first.etag);
	});

	test('a changed configured path is fetched without the previous source validator', async () => {
		const fetchSource = sourceFetch(sources['image/png'], 'image/png', '"source-v1"');
		await getAvatarThumbnail(fetchSource, '/public/first.png');
		await getAvatarThumbnail(fetchSource, '/public/second.png');
		expect(fetchSource.mock.calls[1][0]).toBe('/public/second.png');
		expect(new Headers(fetchSource.mock.calls[1][1]?.headers).has('if-none-match')).toBe(false);
	});

	test('a failed source request can be retried', async () => {
		const fetchSource = sourceFetch(sources['image/png'], 'image/png');
		fetchSource.mockResolvedValueOnce(new Response(null, { status: 404 }));
		await expect(getAvatarThumbnail(fetchSource, '/public/avatar.png')).rejects.toThrow('HTTP 404');
		await expect(getAvatarThumbnail(fetchSource, '/public/avatar.png')).resolves.toHaveProperty(
			'bytes'
		);
	});

	test('rejects oversized sources with or without Content-Length', async () => {
		const fetchSource = vi.fn<typeof fetch>();
		fetchSource.mockResolvedValueOnce(
			new Response(null, { headers: { 'content-type': 'image/png', 'content-length': '9000000' } })
		);
		await expect(getAvatarThumbnail(fetchSource, '/public/avatar.png')).rejects.toThrow(
			'source limit'
		);
		fetchSource.mockResolvedValueOnce(
			new Response(new Uint8Array(8 * 1024 * 1024 + 1), {
				headers: { 'content-type': 'image/png' }
			})
		);
		await expect(getAvatarThumbnail(fetchSource, '/public/avatar.png')).rejects.toThrow(
			'source limit'
		);
	});

	test.each([
		['webp', 'image/webp'],
		['apng', 'image/png']
	] as const)(
		'preserves a valid animated %s instead of flattening it',
		async (format, contentType) => {
			const bytes = await fixtureRenderer.renderAnimation({
				width: 512,
				height: 512,
				fps: 10,
				format,
				scenes: ['red', 'blue'].map((color) => ({
					node: {
						type: 'container' as const,
						style: {
							width: 512,
							height: 512,
							backgroundImage: `linear-gradient(45deg, ${color}, green)`
						}
					},
					durationMs: 100
				}))
			});
			expect(await dimensions(bytes)).toEqual({ width: 512, height: 512 });
			const image = await getAvatarThumbnail(sourceFetch(bytes, contentType), '/public/animated');
			expect(image.contentType).toBe(contentType);
			expect(Buffer.from(image.bytes)).toEqual(bytes);
		}
	);
});
