import { render } from 'svelte/server';
import { ImageResponse } from 'takumi-js/response';
import { Renderer } from 'takumi-js/node';
import type { Appearance } from '@when/config';
import OpengraphImage from '$lib/opengraph/OpengraphImage.svelte';
import { getConfig } from './state.js';
import { hexToRgba } from './color.js';
import { FALLBACK_FONT_NAME, bundledFontUrls, fontStack, isBundledFont } from './fonts.js';

const WIDTH = 1200;
const HEIGHT = 630;
const CACHE_CONTROL = 'public, max-age=3600';

let rendererPromise: Promise<Renderer> | null = null;

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

function getRenderer(fetchFn: typeof fetch, appearance: Appearance): Promise<Renderer> {
	if (!rendererPromise) {
		rendererPromise = (async () => {
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
		})().catch((err) => {
			rendererPromise = null;
			throw err;
		});
	}
	return rendererPromise;
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

export function renderConfiguredOpengraph(fetchFn: typeof fetch): Promise<Response> {
	const { user, url } = getConfig();
	return renderOpengraph(fetchFn, {
		appUrl: url.app,
		appearance: user.appearance
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
