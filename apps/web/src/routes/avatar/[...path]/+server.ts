import { error } from '@sveltejs/kit';
import { lookup } from 'mrmime';
import { getAvatarThumbnail, type AvatarThumbnail } from '#lib/server/avatar.js';
import { getConfig } from '#lib/server/state.js';
import type { RequestHandler } from './$types';

async function fetchOriginalAvatar(
	fetchSource: typeof fetch,
	source: URL,
	requestHeaders: Headers
): Promise<Response> {
	const headers = new Headers({ 'accept-encoding': 'identity' });
	for (const name of ['if-none-match', 'if-modified-since']) {
		const value = requestHeaders.get(name);
		if (value) headers.set(name, value);
	}
	const original = await fetchSource(`${source.pathname}${source.search}`, {
		headers,
		redirect: 'error'
	});
	// Native fetch decodes compressed bodies but retains their encoding/length headers.
	// If the source ignores identity, let the browser load it directly instead.
	const encoding = original.headers.get('content-encoding');
	if (encoding && encoding.toLowerCase() !== 'identity') {
		await original.body?.cancel();
		throw new Error('Avatar source ignored identity encoding.');
	}
	const responseHeaders = new Headers(original.headers);
	if (!responseHeaders.has('content-type')) {
		const type = lookup(source.pathname);
		if (type) responseHeaders.set('content-type', type);
	}
	return new Response(original.body, { status: original.status, headers: responseHeaders });
}

function thumbnailResponse(image: AvatarThumbnail, ifNoneMatch: string | null): Response {
	const headers = new Headers({
		'content-type': image.contentType,
		'cache-control': 'public, max-age=3600',
		etag: image.etag
	});
	const matches = ifNoneMatch?.split(',').some((tag) => {
		const value = tag.trim();
		return value === '*' || value.replace(/^W\//, '') === image.etag;
	});
	if (matches) return new Response(null, { status: 304, headers });
	headers.set('content-length', String(image.bytes.byteLength));
	return new Response(image.bytes, { headers });
}

export const GET: RequestHandler = async ({ fetch, request, url, params }) => {
	const thumbnail = url.searchParams.get('thumbnail');
	if (thumbnail !== null && thumbnail !== 'true' && thumbnail !== 'false') {
		error(400, 'thumbnail must be true or false.');
	}
	const avatarPath = getConfig().user.appearance.avatar_path;
	const source = new URL(avatarPath, url);
	// Only the configured same-origin asset is eligible.
	if (
		!avatarPath.startsWith('/') ||
		source.pathname.startsWith('//') ||
		source.origin !== url.origin
	) {
		error(404);
	}
	let sourcePathname: string;
	try {
		sourcePathname = decodeURIComponent(source.pathname).replace(/\/+$/, '');
	} catch {
		error(404);
	}
	// The avatar route cannot fetch itself as its source.
	if (sourcePathname === '/avatar' || sourcePathname.startsWith('/avatar/')) {
		error(404);
	}
	// The request path only validates cache identity; it never selects a source.
	if (!params.path || `/${params.path}` !== sourcePathname) {
		error(404);
	}
	const sourcePath = `${source.pathname}${source.search}`;
	try {
		if (thumbnail !== 'true') return await fetchOriginalAvatar(fetch, source, request.headers);

		const image = await getAvatarThumbnail(fetch, sourcePath);
		return thumbnailResponse(image, request.headers.get('if-none-match'));
	} catch {
		// A transient failure must not hide an otherwise usable original or cache a redirect.
		return new Response(null, {
			status: 307,
			headers: { location: sourcePath, 'cache-control': 'no-store' }
		});
	}
};
