import type { WhenConfiguration } from '@when/config';
import { logger } from '../services/logger.js';
import type { Attachment } from './recipients.js';

export const BRAND_LOGO_CID = 'brand-logo';

const FETCH_TIMEOUT_MS = 5000;

const cache = new Map<string, Attachment | null>();

function resolveImageUrl(cfg: WhenConfiguration): string | undefined {
	const branding = cfg.user.branding;
	const src = branding?.logo_url ?? branding?.avatar_url;
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
		logger.debug('no brand image configured for email header (logo_url/avatar_url)');
		return null;
	}
	const cached = cache.get(url);
	if (cached) return cached;
	const result = await load(url);
	if (result) cache.set(url, result);
	return result;
}

export function clearLogoCache(): void {
	cache.clear();
}
