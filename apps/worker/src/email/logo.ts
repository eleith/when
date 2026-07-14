import type { WhenConfiguration } from '@when/config';
import { logger } from '../services/logger.js';
import type { Attachment } from './recipients.js';

export const BRAND_LOGO_CID = 'brand-logo';

const FETCH_TIMEOUT_MS = 5000;

// Brand logos rarely change; cache the result (including negatives, so a broken
// URL isn't refetched on every email) for this long before revalidating.
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
	value: Attachment | null;
	fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

function resolveImageUrl(cfg: WhenConfiguration): string | undefined {
	const src = cfg.user.appearance.logo_url;
	if (!src) return undefined;
	const base = cfg.url.internal || cfg.url.app;
	try {
		return new URL(src, base).toString();
	} catch {
		return undefined;
	}
}

function filenameFor(contentType: string): string {
	const ext = contentType.split('/')[1]?.split(';')[0] ?? 'png';
	return `logo.${ext}`;
}

async function load(url: string): Promise<Attachment | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok) {
			logger.warn({ url, status: res.status }, 'brand logo fetch returned non-200');
			return null;
		}
		const contentType = res.headers.get('content-type') ?? 'image/png';
		if (!contentType.startsWith('image/')) {
			logger.warn({ url, contentType }, 'brand logo response is not an image');
			return null;
		}
		const bytes = Buffer.from(await res.arrayBuffer());
		if (bytes.length === 0) {
			logger.warn({ url }, 'brand logo response was empty');
			return null;
		}
		logger.info({ url, bytes: bytes.length, contentType }, 'brand logo embedded in email');
		return {
			filename: filenameFor(contentType),
			content: bytes.toString('base64'),
			contentType,
			cid: BRAND_LOGO_CID,
			encoding: 'base64'
		};
	} catch (err) {
		logger.warn(
			{
				url,
				error: err instanceof Error ? err.message : String(err)
			},
			'brand logo fetch failed'
		);
		return null;
	}
}

export async function fetchBrandLogo(cfg: WhenConfiguration): Promise<Attachment | null> {
	const url = resolveImageUrl(cfg);
	if (!url) {
		logger.debug('no brand image configured for email header (logo_url)');
		return null;
	}
	const cached = cache.get(url);
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
		return cached.value;
	}
	const value = await load(url);
	cache.set(url, { value, fetchedAt: Date.now() });
	return value;
}

export function clearLogoCache(): void {
	cache.clear();
}
