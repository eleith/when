import { once } from 'node:events';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	source: '/public/avatar.jpg',
	thumbnail: vi.fn()
}));
vi.mock('#lib/server/state.js', () => ({
	getConfig: () => ({ user: { appearance: { avatar_path: mocks.source } } })
}));
vi.mock('#lib/server/avatar.js', () => ({ getAvatarThumbnail: mocks.thumbnail }));

import { GET } from './+server';

function createRequestEvent({
	headers = {},
	search = '?thumbnail=true',
	fetchSource = vi.fn<typeof fetch>(),
	path = 'public/avatar.jpg'
}: {
	headers?: Record<string, string>;
	search?: string;
	fetchSource?: typeof fetch;
	path?: string;
} = {}) {
	const url = new URL(`https://when.example/avatar/${path}${search}`);
	return {
		url,
		params: { path: decodeURIComponent(path) },
		request: new Request(url, { headers }),
		fetch: fetchSource
	} as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
	mocks.source = '/public/avatar.jpg';
	mocks.thumbnail.mockReset().mockResolvedValue({
		bytes: new Uint8Array([1, 2, 3]),
		contentType: 'image/webp',
		etag: '"thumbnail"'
	});
});

test.each(['', '?thumbnail=false'])(
	'serves the original without resizing for %s',
	async (search) => {
		const fetchSource = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(new Uint8Array([4, 5, 6]), {
				headers: {
					'content-type': 'image/jpeg',
					'cache-control': 'public, max-age=3600',
					etag: '"original"'
				}
			})
		);
		const response = await GET(createRequestEvent({ search, fetchSource }));
		expect(fetchSource).toHaveBeenCalledWith(
			'/public/avatar.jpg',
			expect.objectContaining({ redirect: 'error' })
		);
		expect(mocks.thumbnail).not.toHaveBeenCalled();
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/jpeg');
		expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
		expect(response.headers.get('etag')).toBe('"original"');
		expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([4, 5, 6]);
	}
);

test.each([
	{ behavior: 'honors identity encoding', ignoreIdentity: false },
	{ behavior: 'ignores identity encoding', ignoreIdentity: true }
])('safely forwards an upstream that $behavior', async ({ ignoreIdentity }) => {
	const source = Buffer.from(
		'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="green"/></svg>'
	);
	const compressed = gzipSync(source);
	const encodings: (string | undefined)[] = [];
	const server = createServer((request, response) => {
		encodings.push(request.headers['accept-encoding']);
		const useGzip = ignoreIdentity || request.headers['accept-encoding'] !== 'identity';
		const body = useGzip ? compressed : source;
		response.writeHead(200, {
			'content-type': 'image/svg+xml',
			'content-length': String(body.byteLength),
			...(useGzip ? { 'content-encoding': 'gzip' } : {})
		});
		response.end(body);
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	try {
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
		const sourceUrl = `http://127.0.0.1:${address.port}/image.svg`;
		// Reproduce native fetch's decoded body with still-compressed metadata.
		const probe = await fetch(sourceUrl, { headers: { 'accept-encoding': 'gzip' } });
		expect(probe.headers.get('content-encoding')).toBe('gzip');
		expect(Buffer.from(await probe.arrayBuffer())).toEqual(source);

		mocks.source = '/public/avatar.svg';
		const fetchSource = vi
			.fn<typeof fetch>()
			.mockImplementation((_input, init) => fetch(sourceUrl, init));
		const response = await GET(
			createRequestEvent({ search: '', path: 'public/avatar.svg', fetchSource })
		);
		expect(encodings.at(-1)).toBe('identity');
		expect(mocks.thumbnail).not.toHaveBeenCalled();
		if (ignoreIdentity) {
			expect(response.status).toBe(307);
			expect(response.headers.get('location')).toBe('/public/avatar.svg');
			expect(response.headers.get('cache-control')).toBe('no-store');
		} else {
			expect(response.status).toBe(200);
			expect(response.headers.get('content-encoding')).toBeNull();
			expect(response.headers.get('content-length')).toBe(String(source.byteLength));
			expect(Buffer.from(await response.arrayBuffer())).toEqual(source);
		}
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
});

test('restores the full image MIME when dev fetch omits its headers', async () => {
	const fetchSource = vi
		.fn<typeof fetch>()
		.mockResolvedValue(new Response(new Uint8Array([4, 5, 6])));
	const response = await GET(createRequestEvent({ search: '', fetchSource }));
	expect(response.headers.get('content-type')).toBe('image/jpeg');
	expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([4, 5, 6]);
});

test('forwards original-image validators and preserves a source 304 response', async () => {
	const fetchSource = vi
		.fn<typeof fetch>()
		.mockResolvedValue(new Response(null, { status: 304, headers: { etag: '"original"' } }));
	const response = await GET(
		createRequestEvent({
			search: '',
			headers: {
				'if-none-match': '"original"',
				'if-modified-since': 'Mon, 02 Nov 2026 00:00:00 GMT'
			},
			fetchSource
		})
	);
	const headers = new Headers(fetchSource.mock.calls[0][1]?.headers);
	expect(headers.get('if-none-match')).toBe('"original"');
	expect(headers.get('if-modified-since')).toBe('Mon, 02 Nov 2026 00:00:00 GMT');
	expect(response.status).toBe(304);
	expect(response.headers.get('etag')).toBe('"original"');
	expect(await response.text()).toBe('');
	expect(mocks.thumbnail).not.toHaveBeenCalled();
});

test.each(['', '1', 'full'])('rejects an unsupported thumbnail parameter: %s', async (value) => {
	await expect(GET(createRequestEvent({ search: `?thumbnail=${value}` }))).rejects.toMatchObject({
		status: 400
	});
	expect(mocks.thumbnail).not.toHaveBeenCalled();
});

test('serves the configured avatar derivative with cache validators', async () => {
	const requestEvent = createRequestEvent();
	const response = await GET(requestEvent);
	expect(mocks.thumbnail).toHaveBeenCalledWith(requestEvent.fetch, '/public/avatar.jpg');
	expect(response.status).toBe(200);
	expect(response.headers.get('content-type')).toBe('image/webp');
	expect(response.headers.get('content-length')).toBe('3');
	expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
	expect(response.headers.get('etag')).toBe('"thumbnail"');
	expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
});

test.each(['"thumbnail"', 'W/"thumbnail"', '"another", "thumbnail"', '*'])(
	'returns 304 for a matching If-None-Match: %s',
	async (etag) => {
		const response = await GET(createRequestEvent({ headers: { 'if-none-match': etag } }));
		expect(response.status).toBe(304);
		expect(response.headers.get('etag')).toBe('"thumbnail"');
		expect(response.headers.has('content-length')).toBe(false);
		expect(await response.text()).toBe('');
	}
);

test('a changed derivative does not match a stale client validator', async () => {
	const response = await GET(
		createRequestEvent({ headers: { 'if-none-match': '"old-thumbnail"' } })
	);
	expect(response.status).toBe(200);
});

test('preserves query parameters on a configured local source', async () => {
	mocks.source = '/public/avatar.jpg?revision=2';
	const requestEvent = createRequestEvent();
	await GET(requestEvent);
	expect(mocks.thumbnail).toHaveBeenCalledWith(requestEvent.fetch, mocks.source);
});

test('query parameters cannot select an arbitrary image source', async () => {
	const requestEvent = createRequestEvent();
	requestEvent.url.searchParams.set('source', 'https://elsewhere.example/image.jpg');
	await GET(requestEvent);
	expect(mocks.thumbnail).toHaveBeenCalledWith(requestEvent.fetch, '/public/avatar.jpg');
});

test('source failures redirect to the original without caching the failure', async () => {
	mocks.thumbnail.mockRejectedValueOnce(new Error('source unavailable'));
	const response = await GET(createRequestEvent());
	expect(response.status).toBe(307);
	expect(response.headers.get('location')).toBe('/public/avatar.jpg');
	expect(response.headers.get('cache-control')).toBe('no-store');
});

test.each(['', '?thumbnail=true'])(
	'rejects a mismatched or missing validation path for %s',
	async (search) => {
		const fetchSource = vi.fn<typeof fetch>();
		for (const path of ['public/another.jpg', '']) {
			await expect(GET(createRequestEvent({ search, fetchSource, path }))).rejects.toMatchObject({
				status: 404
			});
		}
		expect(fetchSource).not.toHaveBeenCalled();
		expect(mocks.thumbnail).not.toHaveBeenCalled();
	}
);

test('validates a decoded filename but fetches the configured encoded source', async () => {
	mocks.source = '/public/profile photo.jpg?revision=2';
	const requestEvent = createRequestEvent({ path: 'public/profile%20photo.jpg' });
	await GET(requestEvent);
	expect(mocks.thumbnail).toHaveBeenCalledWith(
		requestEvent.fetch,
		'/public/profile%20photo.jpg?revision=2'
	);
});

test.each(['', '?thumbnail=true'])(
	'rejects configured sources in the avatar route namespace for %s',
	async (search) => {
		const fetchSource = vi.fn<typeof fetch>();
		for (const source of ['/%61vatar', '/avatar/public/avatar.jpg']) {
			mocks.source = source;
			await expect(
				GET(createRequestEvent({ search, fetchSource, path: source.slice(1) }))
			).rejects.toMatchObject({ status: 404 });
		}
		expect(fetchSource).not.toHaveBeenCalled();
		expect(mocks.thumbnail).not.toHaveBeenCalled();
	}
);

test.each([
	'https://elsewhere.example/avatar.jpg',
	'/\t/elsewhere.example/avatar.jpg',
	'/folder/..//elsewhere.example/avatar.png',
	'/avatar',
	'/avatar?thumbnail=true',
	'/%61vatar',
	'/avatar/'
])('rejects off-origin or recursive configured sources: %s', async (source) => {
	mocks.source = source;
	const path = new URL(source, 'https://when.example').pathname.slice(1);
	const fetchSource = vi.fn<typeof fetch>();
	await expect(GET(createRequestEvent({ fetchSource, path }))).rejects.toMatchObject({
		status: 404
	});
	expect(fetchSource).not.toHaveBeenCalled();
	expect(mocks.thumbnail).not.toHaveBeenCalled();
});
