import { createHash } from 'node:crypto';
import { Avatar, Style } from '@dicebear/core';
import { Renderer } from 'takumi-js/node';
import { lookup } from 'mrmime';
// DiceBear "thumbs" style, vendored (CC0 1.0, see meta.license in the JSON).
import thumbs from './thumbs.json';

const style = new Style(thumbs);

export interface AvatarColors {
	// Canvas background. Hex, with or without a leading '#'.
	backgroundColor?: string;
	// Thumb character body shape color. Defaults to backgroundColor if omitted.
	shapeColor?: string;
	// Face features (eyes + mouth) color on top of the thumb body.
	textColor?: string;
}

// A deterministic default avatar seeded from a string (the owner's name), so the
// same input always renders the same face. Colors default to the style's palette;
// pass brand colors to match the app's theme. Returns an SVG string.
export function defaultAvatar(seed: string, colors: AvatarColors = {}): string {
	const hex = (c: string) => [c.replace(/^#/, '')];
	const shapeColor = colors.shapeColor ?? colors.backgroundColor;
	return new Avatar(style, {
		seed,
		...(colors.backgroundColor && { backgroundColor: hex(colors.backgroundColor) }),
		...(shapeColor && { shapeColor: hex(shapeColor) }),
		...(colors.textColor && {
			eyesColor: hex(colors.textColor),
			mouthColor: hex(colors.textColor)
		})
	}).toString();
}

const SIZE = 216;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export interface AvatarThumbnail {
	bytes: Uint8Array<ArrayBuffer>;
	contentType: string;
	etag: string;
}

let renderer: Renderer | undefined;
let cachedAvatar: {
	source: string;
	contentType: string;
	sourceDigest: string;
	sourceEtag: string | null;
	thumbnail: AvatarThumbnail;
} | null = null;
const inFlightAvatars = new Map<string, Promise<AvatarThumbnail>>();

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

async function readSource(response: Response): Promise<Buffer> {
	if (Number(response.headers.get('content-length')) > MAX_SOURCE_BYTES) {
		await response.body?.cancel();
		throw new Error('Avatar exceeds the thumbnail source limit.');
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error('Avatar has no image body.');
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_SOURCE_BYTES) {
				await reader.cancel();
				throw new Error('Avatar exceeds the thumbnail source limit.');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks);
}

function isAnimated(bytes: Buffer, contentType: string): boolean {
	if (contentType === 'image/webp') {
		return bytes.length > 20 && bytes.toString('ascii', 12, 16) === 'VP8X' && !!(bytes[20] & 2);
	}
	if (contentType === 'image/png') {
		// APNG declares its animation before the first image-data chunk.
		for (let offset = 8; offset + 12 <= bytes.length; ) {
			const type = bytes.toString('ascii', offset + 4, offset + 8);
			if (type === 'acTL') return true;
			if (type === 'IDAT') return false;
			offset += 12 + bytes.readUInt32BE(offset);
		}
	}
	return false;
}

/** Return a smaller WebP, or null when the original should be kept. */
async function tryResizeAvatar(bytes: Buffer, contentType: string): Promise<Uint8Array | null> {
	if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return null;
	if (isAnimated(bytes, contentType)) return null;

	try {
		renderer ??= new Renderer();
		const image = { type: 'image' as const, src: bytes };
		const { width, height } = await renderer.measure(image);
		if (width <= SIZE && height <= SIZE) return null;

		const size = Math.floor(Math.min(SIZE, width, height));
		const resized = await renderer.render(
			{ ...image, width: size, height: size, style: { objectFit: 'cover' } },
			{ width: size, height: size, format: 'webp', quality: 80 }
		);
		return resized.byteLength < bytes.byteLength ? resized : null;
	} catch {
		// Unsupported/corrupt inputs keep the original rather than breaking the avatar.
		return null;
	}
}

async function createThumbnail(bytes: Buffer, contentType: string): Promise<AvatarThumbnail> {
	const resized = await tryResizeAvatar(bytes, contentType);
	const output = resized ?? bytes;
	const outputContentType = resized ? 'image/webp' : contentType;
	return {
		bytes: Uint8Array.from(output),
		contentType: outputContentType,
		etag: `"${digest(output)}"`
	};
}

async function loadAvatarThumbnail(
	fetchFn: typeof fetch,
	source: string
): Promise<AvatarThumbnail> {
	const cacheBeforeFetch = cachedAvatar?.source === source ? cachedAvatar : null;
	const headers = new Headers({ 'accept-encoding': 'identity' });
	if (cacheBeforeFetch?.sourceEtag) headers.set('if-none-match', cacheBeforeFetch.sourceEtag);
	const response = await fetchFn(source, { headers, redirect: 'error' });
	if (response.status === 304 && cacheBeforeFetch) return cacheBeforeFetch.thumbnail;
	const encoding = response.headers.get('content-encoding');
	if (encoding && encoding.toLowerCase() !== 'identity') {
		await response.body?.cancel();
		throw new Error('Avatar source ignored identity encoding.');
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`Avatar source returned HTTP ${response.status}.`);
	}
	// Kit's dev asset reader can omit MIME headers for files outside static/.
	const contentType = (
		response.headers.get('content-type') ??
		lookup(new URL(source, 'http://when.invalid').pathname) ??
		''
	)
		.split(';', 1)[0]
		.trim()
		.toLowerCase();
	if (!contentType.startsWith('image/')) {
		await response.body?.cancel();
		throw new Error('Avatar source is not an image.');
	}
	const bytes = await readSource(response);
	const sourceDigest = digest(bytes);
	const sourceEtag = response.headers.get('etag');
	const cacheAfterRead = cachedAvatar;
	if (
		cacheAfterRead?.source === source &&
		cacheAfterRead.contentType === contentType &&
		cacheAfterRead.sourceDigest === sourceDigest
	) {
		cacheAfterRead.sourceEtag = sourceEtag;
		return cacheAfterRead.thumbnail;
	}
	const thumbnail = await createThumbnail(bytes, contentType);
	cachedAvatar = { source, contentType, sourceDigest, sourceEtag, thumbnail };
	return thumbnail;
}

/** Revalidate between requests; concurrent callers share the entire load and resize. */
export function getAvatarThumbnail(
	fetchFn: typeof fetch,
	source: string
): Promise<AvatarThumbnail> {
	const inFlight = inFlightAvatars.get(source);
	if (inFlight) return inFlight;

	const thumbnailPromise = loadAvatarThumbnail(fetchFn, source).finally(() => {
		inFlightAvatars.delete(source);
	});
	inFlightAvatars.set(source, thumbnailPromise);
	return thumbnailPromise;
}
