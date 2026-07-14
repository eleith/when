import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { resolve, sep } from 'node:path';
import { error } from '@sveltejs/kit';
import { lookup } from 'mrmime';
import { resolvePublicDir } from '@when/config';
import type { RequestHandler } from './$types';

const CACHE_CONTROL = 'public, max-age=3600';

export const GET: RequestHandler = async ({ params, request }) => {
	const publicDir = resolvePublicDir();
	const resolved = resolve(publicDir, params.file);

	// Reject anything that escapes publicDir (e.g. `../`).
	if (resolved !== publicDir && !resolved.startsWith(publicDir + sep)) {
		error(404);
	}

	let stats;
	try {
		stats = await stat(resolved);
	} catch {
		error(404);
	}
	if (!stats.isFile()) {
		error(404);
	}

	const etag = `W/"${stats.size}-${Math.round(stats.mtimeMs)}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304, headers: { etag, 'cache-control': CACHE_CONTROL } });
	}

	const body = Readable.toWeb(createReadStream(resolved)) as ReadableStream<Uint8Array>;
	return new Response(body, {
		headers: {
			'content-type': lookup(resolved) ?? 'application/octet-stream',
			'content-length': String(stats.size),
			'cache-control': CACHE_CONTROL,
			etag
		}
	});
};
