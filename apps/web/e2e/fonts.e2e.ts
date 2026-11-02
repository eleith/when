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

	await page.goto('/schedule/chat');
	const preload = page.locator('head link[rel="preload"][as="font"]');
	await expect(preload).toHaveCount(1);
	await expect(preload).toHaveAttribute('href', regularFont);
	await expect(preload).toHaveAttribute('type', 'font/woff2');
	await expect(preload).toHaveAttribute('crossorigin', 'anonymous');
	await page.evaluate(() => document.fonts.ready.then(() => {}));

	expect(fontRequests.filter((path) => path === regularFont)).toHaveLength(1);
	expect(fontRequests.every((path) => path.startsWith('/assets/fonts/noto-sans/'))).toBe(true);
});
