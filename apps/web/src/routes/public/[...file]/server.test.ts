import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';
import type { RequestEvent } from './$types';

let dir: string;
const saved = { ...process.env };

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'when-public-'));
	process.env.WHEN_PUBLIC_DIR = dir;
});

afterEach(async () => {
	process.env = { ...saved };
	await rm(dir, { recursive: true, force: true });
});

function event(file: string, headers: Record<string, string> = {}): RequestEvent {
	return {
		params: { file },
		request: new Request(`http://localhost/public/${file}`, { headers })
	} as unknown as RequestEvent;
}

test('serves a file with the mrmime content-type and cache headers', async () => {
	await writeFile(join(dir, 'logo.png'), Buffer.from([1, 2, 3]));
	const res = await GET(event('logo.png'));
	expect(res.status).toBe(200);
	expect(res.headers.get('content-type')).toBe('image/png');
	expect(res.headers.get('content-length')).toBe('3');
	expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
	expect(res.headers.get('etag')).toBeTruthy();
	expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
});

test('falls back to application/octet-stream for unknown extensions', async () => {
	await writeFile(join(dir, 'blob.unknownext'), 'x');
	const res = await GET(event('blob.unknownext'));
	expect(res.headers.get('content-type')).toBe('application/octet-stream');
});

test('returns 304 when If-None-Match matches the etag', async () => {
	await writeFile(join(dir, 'a.txt'), 'hi');
	const first = await GET(event('a.txt'));
	const etag = first.headers.get('etag') ?? '';
	const res = await GET(event('a.txt', { 'if-none-match': etag }));
	expect(res.status).toBe(304);
	expect(res.headers.get('etag')).toBe(etag);
});

test('404 on a missing file', async () => {
	await expect(GET(event('nope.png'))).rejects.toMatchObject({ status: 404 });
});

test('404 on a path that escapes publicDir via ..', async () => {
	await writeFile(join(dir, 'secret.txt'), 'nope');
	await expect(GET(event('../secret.txt'))).rejects.toMatchObject({ status: 404 });
	await expect(GET(event('../../etc/passwd'))).rejects.toMatchObject({ status: 404 });
});
