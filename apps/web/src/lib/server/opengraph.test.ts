import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { renderOpengraph } from './opengraph';
import { defaultAvatar } from './avatar';
import { validConfig } from './__fixtures__/valid-config';

const STATIC_DIR = fileURLToPath(new URL('../../../static', import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL('../../../public', import.meta.url));

// Serve the URLs the pipeline fetches (Outfit fonts + logo from /static, the
// avatar route generated on the fly, custom assets from /public) the way SvelteKit's `fetch` would.
const fakeFetch: typeof fetch = async (input) => {
	const url = typeof input === 'string' ? input : (input as Request).url;
	const path = new URL(url, 'http://localhost').pathname;
	if (path === '/assets/images/avatar.svg') {
		return new Response(defaultAvatar('Jane Doe'), {
			headers: { 'content-type': 'image/svg+xml' }
		});
	}
	if (path.startsWith('/public/')) {
		const data = await readFile(join(PUBLIC_DIR, path.replace(/^\/public\//, '')));
		return new Response(data);
	}
	const data = await readFile(join(STATIC_DIR, path));
	return new Response(data);
};

function readUint32BE(bytes: Uint8Array, offset: number): number {
	return (
		(bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
	);
}

test('renders a 1200x630 PNG from the appearance', async () => {
	const { appearance } = validConfig.user;
	const response = await renderOpengraph(fakeFetch, { appUrl: 'eleith.com', appearance });

	expect(response.headers.get('content-type')).toBe('image/png');
	expect(response.headers.get('cache-control')).toBe('public, max-age=3600');

	const bytes = new Uint8Array(await response.arrayBuffer());
	// PNG signature, then the IHDR chunk carries width/height as big-endian u32s.
	expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	expect(readUint32BE(bytes, 16)).toBe(1200);
	expect(readUint32BE(bytes, 20)).toBe(630);
});

test('still renders when the logo and avatar cannot be loaded', async () => {
	const failingFetch: typeof fetch = async (input) => {
		const url = typeof input === 'string' ? input : (input as Request).url;
		const path = new URL(url, 'http://localhost').pathname;
		if (path.endsWith('.woff2')) return fakeFetch(input);
		return new Response(null, { status: 404 });
	};

	const { appearance } = validConfig.user;
	const response = await renderOpengraph(failingFetch, { appUrl: 'eleith.com', appearance });
	const bytes = new Uint8Array(await response.arrayBuffer());
	expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	expect(readUint32BE(bytes, 16)).toBe(1200);
});

test('still renders with fallback to default avatar when avatar is an avif file', async () => {
	let fetchedDefaultAvatar = false;
	const trackingFetch: typeof fetch = async (input, init) => {
		const url = typeof input === 'string' ? input : (input as Request).url;
		const path = new URL(url, 'http://localhost').pathname;
		if (path === '/assets/images/avatar.svg') {
			fetchedDefaultAvatar = true;
		}
		return fakeFetch(input, init);
	};

	const appearance = {
		...validConfig.user.appearance,
		avatar_path: '/public/avatar.avif'
	};
	const response = await renderOpengraph(trackingFetch, { appUrl: 'eleith.com', appearance });
	expect(fetchedDefaultAvatar).toBe(true);

	const bytes = new Uint8Array(await response.arrayBuffer());
	expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	expect(readUint32BE(bytes, 16)).toBe(1200);
	expect(readUint32BE(bytes, 20)).toBe(630);
});

test('still renders when avatar data is corrupted', async () => {
	const corruptFetch: typeof fetch = async (input) => {
		const url = typeof input === 'string' ? input : (input as Request).url;
		const path = new URL(url, 'http://localhost').pathname;
		if (path === '/public/corrupt.png') {
			return new Response(Buffer.from('not an image'));
		}
		return fakeFetch(input);
	};
	const appearance = {
		...validConfig.user.appearance,
		avatar_path: '/public/corrupt.png'
	};
	const response = await renderOpengraph(corruptFetch, { appUrl: 'eleith.com', appearance });
	const bytes = new Uint8Array(await response.arrayBuffer());
	expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	expect(readUint32BE(bytes, 16)).toBe(1200);
	expect(readUint32BE(bytes, 20)).toBe(630);
});

test('still renders with fallback to default app icon when app icon is corrupted', async () => {
	let fetchedDefaultIcon = false;
	const trackingFetch: typeof fetch = async (input, init) => {
		const url = typeof input === 'string' ? input : (input as Request).url;
		const path = new URL(url, 'http://localhost').pathname;
		if (path === '/public/corrupt-icon.png') {
			return new Response(Buffer.from('not an image'));
		}
		if (path === '/assets/images/app-icon.svg') {
			fetchedDefaultIcon = true;
		}
		return fakeFetch(input, init);
	};
	const appearance = {
		...validConfig.user.appearance,
		app_icon_path: '/public/corrupt-icon.png'
	};
	const response = await renderOpengraph(trackingFetch, { appUrl: 'eleith.com', appearance });
	expect(fetchedDefaultIcon).toBe(true);

	const bytes = new Uint8Array(await response.arrayBuffer());
	expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	expect(readUint32BE(bytes, 16)).toBe(1200);
	expect(readUint32BE(bytes, 20)).toBe(630);
});

// The renderer (and the fonts registered on it) is cached at module level, so
// the custom-font paths need a freshly imported module.
async function freshRenderOpengraph(): Promise<typeof renderOpengraph> {
	vi.resetModules();
	return (await import('./opengraph')).renderOpengraph;
}

test('registers a custom font_path font', async () => {
	const render = await freshRenderOpengraph();
	const appearance = {
		...validConfig.user.appearance,
		font_name: 'Custom',
		font_path: '/public/custom.woff2'
	};
	const customFetch: typeof fetch = async (input) => {
		const url = typeof input === 'string' ? input : (input as Request).url;
		const path = new URL(url, 'http://localhost').pathname;
		if (path === '/public/custom.woff2') {
			return fakeFetch('/assets/fonts/outfit/outfit-latin-400-normal.woff2');
		}
		return fakeFetch(input);
	};

	const response = await render(customFetch, { appUrl: 'eleith.com', appearance });
	const bytes = new Uint8Array(await response.arrayBuffer());
	expect(readUint32BE(bytes, 16)).toBe(1200);
});

test('still renders when the custom font cannot be loaded', async () => {
	const render = await freshRenderOpengraph();
	const appearance = {
		...validConfig.user.appearance,
		font_name: 'Custom',
		font_path: '/public/missing.woff2'
	};

	const response = await render(fakeFetch, { appUrl: 'eleith.com', appearance });
	const bytes = new Uint8Array(await response.arrayBuffer());
	expect(readUint32BE(bytes, 16)).toBe(1200);
});

async function freshModules() {
	vi.resetModules();
	const state = await import('./state');
	const opengraph = await import('./opengraph');
	state.setState({ config: validConfig, db: {} as never });
	return {
		...opengraph,
		setConfig: (c: typeof validConfig) => state.setState({ config: c, db: {} as never })
	};
}

test('the configured png is rendered once and replayed', async () => {
	const { renderConfiguredOpengraph } = await freshModules();
	let fetches = 0;
	const countingFetch: typeof fetch = (...args) => {
		fetches += 1;
		return fakeFetch(...args);
	};

	const first = new Uint8Array(
		await (await renderConfiguredOpengraph(countingFetch)).arrayBuffer()
	);
	expect(fetches).toBeGreaterThan(0);

	fetches = 0;
	const second = new Uint8Array(
		await (await renderConfiguredOpengraph(countingFetch)).arrayBuffer()
	);

	expect(fetches).toBe(0);
	expect(second).toEqual(first);
	expect(readUint32BE(second, 16)).toBe(1200);
});

test('a swapped-in config re-renders; a rejected reload leaves the cache alone', async () => {
	const { renderConfiguredOpengraph, setConfig } = await freshModules();
	let fetches = 0;
	const countingFetch: typeof fetch = (...args) => {
		fetches += 1;
		return fakeFetch(...args);
	};

	await renderConfiguredOpengraph(countingFetch);

	// A rejected reload never reaches setState, so the config object is unchanged.
	fetches = 0;
	await renderConfiguredOpengraph(countingFetch);
	expect(fetches).toBe(0);

	setConfig({ ...validConfig });

	fetches = 0;
	const response = await renderConfiguredOpengraph(countingFetch);

	expect(fetches).toBeGreaterThan(0);
	expect(response.headers.get('content-type')).toBe('image/png');
	expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
});
