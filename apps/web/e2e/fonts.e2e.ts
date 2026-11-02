import { expect, test } from './support/test.ts';

test.use({ javaScriptEnabled: false });

test('HTML preloads only the regular configured font and CSS reuses its request', async ({
	page
}) => {
	const regularFont = '/assets/fonts/noto-sans/noto-sans-latin-400-normal.woff2';
	const fontRequests: string[] = [];
	page.on('request', (request) => {
		const path = new URL(request.url()).pathname;
		if (path.endsWith('.woff2')) fontRequests.push(path);
	});

	const fontResponse = page.waitForResponse(
		(response) => new URL(response.url()).pathname === regularFont
	);
	await page.goto('/schedule/chat');
	expect((await fontResponse).ok()).toBe(true);
	const preload = page.locator('head link[rel="preload"][as="font"]');
	await expect(preload).toHaveCount(1);
	await expect(preload).toHaveAttribute('href', regularFont);
	await expect(preload).toHaveAttribute('type', 'font/woff2');
	await expect(preload).toHaveAttribute('crossorigin', 'anonymous');
	const fontState = await page.evaluate(async () => {
		await document.fonts.ready;
		return {
			bodyFontFamily: getComputedStyle(document.body).fontFamily,
			regularFontLoaded: Array.from(document.fonts).some(
				(face) =>
					face.family.replace(/["']/g, '') === 'Noto Sans' &&
					face.weight === '400' &&
					face.status === 'loaded'
			)
		};
	});
	expect(fontState.bodyFontFamily).toMatch(/^["']?Noto Sans["']?(?:,|$)/);
	expect(fontState.regularFontLoaded).toBe(true);

	expect(fontRequests.filter((path) => path === regularFont)).toHaveLength(1);
	expect(fontRequests.every((path) => path.startsWith('/assets/fonts/noto-sans/'))).toBe(true);
});
