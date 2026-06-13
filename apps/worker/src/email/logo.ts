import type { WhenConfiguration } from '@when/config';
import { log } from '../services/logger.js';
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
			log('warn', 'brand logo fetch returned non-200', { url, status: res.status });
			return null;
		}
		const contentType = res.headers.get('content-type') ?? 'image/png';
		if (!contentType.startsWith('image/')) {
			log('warn', 'brand logo response is not an image', { url, contentType });
			return null;
		}
		const bytes = Buffer.from(await res.arrayBuffer());
		if (bytes.length === 0) {
			log('warn', 'brand logo response was empty', { url });
			return null;
		}
		log('info', 'brand logo embedded in email', { url, bytes: bytes.length, contentType });
		return {
			filename: filenameFor(contentType),
			content: bytes.toString('base64'),
			contentType,
			cid: BRAND_LOGO_CID,
			encoding: 'base64'
		};
	} catch (err) {
		log('warn', 'brand logo fetch failed', {
			url,
			error: err instanceof Error ? err.message : String(err)
		});
		return null;
	}
}

export async function fetchBrandLogo(cfg: WhenConfiguration): Promise<Attachment | null> {
	const url = resolveImageUrl(cfg);
	if (!url) {
		log('debug', 'no brand image configured for email header (logo_url/avatar_url)');
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
