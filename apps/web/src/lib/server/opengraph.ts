import { render } from 'svelte/server';
import { ImageResponse } from 'takumi-js/response';
import { Renderer } from 'takumi-js/node';
import type { Appearance, WhenConfiguration } from '@when/config';
import OpengraphImage from '$lib/opengraph/OpengraphImage.svelte';
import { getConfig } from './state.js';
import { hexToRgba } from './color.js';
import { FALLBACK_FONT_NAME, bundledFontUrls, fontStack, isBundledFont } from './fonts.js';

const WIDTH = 1200;
const HEIGHT = 630;
const CACHE_CONTROL = 'public, max-age=3600';

// Both caches key on the object they were built from. A config reload installs a new
// one, which is the invalidation; a rejected reload never installs anything.
let cachedRenderer: { appearance: Appearance; renderer: Promise<Renderer> } | null = null;
let cachedPng: { config: WhenConfiguration; png: Promise<ArrayBuffer> } | null = null;

async function registerBundledFamily(
	renderer: Renderer,
	fetchFn: typeof fetch,
	family: string
): Promise<void> {
	for (const url of bundledFontUrls(family)) {
		const res = await fetchFn(url);
		if (!res.ok) throw new Error(`opengraph: failed to load font ${url} (${res.status})`);
		await renderer.registerFont(Buffer.from(await res.arrayBuffer()));
	}
}

async function buildRenderer(fetchFn: typeof fetch, appearance: Appearance): Promise<Renderer> {
	const renderer = new Renderer();
	const family = appearance.font_name;
	if (isBundledFont(family)) {
		await registerBundledFamily(renderer, fetchFn, family);
	} else {
		await registerBundledFamily(renderer, fetchFn, FALLBACK_FONT_NAME);
		if (appearance.font_url) {
			try {
				const res = await fetchFn(appearance.font_url);
				if (res.ok) {
					await renderer.registerFont({
						name: appearance.font_name,
						data: Buffer.from(await res.arrayBuffer())
					});
				}
			} catch {
				// fall back to the fallback family
			}
		}
	}
	return renderer;
}

function getRenderer(fetchFn: typeof fetch, appearance: Appearance): Promise<Renderer> {
	if (cachedRenderer?.appearance === appearance) return cachedRenderer.renderer;

	// Drop a failed build so the next request retries rather than replaying the error.
	const renderer = buildRenderer(fetchFn, appearance).catch((err) => {
		if (cachedRenderer?.appearance === appearance) cachedRenderer = null;
		throw err;
	});
	cachedRenderer = { appearance, renderer };
	return renderer;
}

async function loadImage(
	fetchFn: typeof fetch,
	url: string
): Promise<{ src: string; data: Buffer } | null> {
	try {
		const res = await fetchFn(url);
		if (!res.ok) return null;
		return { src: url, data: Buffer.from(await res.arrayBuffer()) };
	} catch {
		return null;
	}
}

export interface OpengraphInput {
	appUrl: string;
	appearance: Appearance;
}

function formatDisplayUrl(appUrl: string): string {
	return appUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

async function renderPng(fetchFn: typeof fetch, config: WhenConfiguration): Promise<ArrayBuffer> {
	const rendered = await renderOpengraph(fetchFn, {
		appUrl: config.url.app,
		appearance: config.user.appearance
	});
	return rendered.arrayBuffer();
}

export async function renderConfiguredOpengraph(fetchFn: typeof fetch): Promise<Response> {
	const config = getConfig();
	if (cachedPng?.config !== config) {
		const png = renderPng(fetchFn, config).catch((err) => {
			if (cachedPng?.config === config) cachedPng = null;
			throw err;
		});
		cachedPng = { config, png };
	}

	// A Response body is single-use, so each request gets a new one over the same bytes.
	return new Response(await cachedPng.png, {
		headers: { 'content-type': 'image/png', 'cache-control': CACHE_CONTROL }
	});
}

export async function renderOpengraph(
	fetchFn: typeof fetch,
	input: OpengraphInput
): Promise<Response> {
	const { appUrl, appearance } = input;
	const primary = appearance.primary_light_color;
	const text = appearance.text_light_color;

	const [appIcon, avatar, renderer] = await Promise.all([
		loadImage(fetchFn, appearance.app_icon_url),
		loadImage(fetchFn, appearance.avatar_url),
		getRenderer(fetchFn, appearance)
	]);

	const { head, body } = render(OpengraphImage, {
		props: {
			title: appearance.title,
			description: appearance.description,
			fontFamily: fontStack(appearance.font_name),
			url: formatDisplayUrl(appUrl),
			appIconSrc: appIcon?.src,
			avatarSrc: avatar?.src,
			primary,
			primaryTint: hexToRgba(primary, 0.45),
			text,
			background: appearance.background_light_color,
			muted: hexToRgba(text, 0.58)
		}
	});

	return new ImageResponse(`${head}${body}`, {
		width: WIDTH,
		height: HEIGHT,
		format: 'png',
		renderer,
		images: [appIcon, avatar].filter((image) => image !== null),
		headers: { 'cache-control': CACHE_CONTROL }
	});
}
