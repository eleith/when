import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { Renderer } from 'takumi-js/node';
import { avatarThumbnailUrl } from '../src/lib/avatar.ts';
import { expect, test, type Page } from './support/test.ts';
import { workerDirectory } from './support/paths.ts';
import { seedAppointment } from './support/seed.ts';

const SOURCE_PATH = '/public/avatar source test.png';
const ORIGINAL_URL = '/avatar/public/avatar%20source%20test.png';
const THUMBNAIL_URL = `${ORIGINAL_URL}?thumbnail=true`;
const DEFAULT_AVATAR_URL = '/avatar/assets/images/avatar.svg?thumbnail=true';

test.use({ javaScriptEnabled: false });

async function setAvatarSource(page: Page, sourcePath: string) {
	const configPath = join(workerDirectory(), 'config/when.yaml');
	const config = parse(await readFile(configPath, 'utf8'));
	config.user.appearance = { ...config.user.appearance, avatar_path: sourcePath };
	await writeFile(configPath, stringify(config));
	const expectedUrl = avatarThumbnailUrl(sourcePath).replaceAll('&', '&amp;');
	await expect.poll(async () => (await page.request.get('/')).text()).toContain(expectedUrl);
}

async function withRasterAvatar(page: Page, run: (source: Buffer) => Promise<void>) {
	const directory = workerDirectory();
	const configPath = join(directory, 'config/when.yaml');
	const originalConfig = await readFile(configPath, 'utf8');
	const sourceFile = join(directory, 'public/avatar source test.png');
	const source = await new Renderer().render(
		{ type: 'container', style: { width: 800, height: 800, backgroundColor: '#166534' } },
		{ width: 800, height: 800, format: 'png' }
	);
	await mkdir(join(directory, 'public'), { recursive: true });
	try {
		await writeFile(sourceFile, source);
		await setAvatarSource(page, SOURCE_PATH);
		await run(source);
	} finally {
		await writeFile(configPath, originalConfig);
		await expect
			.poll(async () => (await page.request.get('/')).text())
			.toContain(DEFAULT_AVATAR_URL);
		await rm(sourceFile, { force: true });
	}
}

async function expectPageAvatars(page: Page, count: number) {
	const avatars = page.getByRole('img', { name: 'E2E Fixture', exact: true, includeHidden: true });
	await expect(avatars).toHaveCount(count);
	for (const avatar of await avatars.all()) {
		await expect(avatar).toHaveAttribute('src', THUMBNAIL_URL);
	}
	await expect
		.poll(() =>
			avatars.evaluateAll((images) =>
				images.every((image) => {
					const img = image as HTMLImageElement;
					return img.complete && img.naturalWidth === 216 && img.naturalHeight === 216;
				})
			)
		)
		.toBe(true);
}

test('default SVG avatars stay vector images', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('img', { name: 'E2E Fixture', exact: true })).toHaveAttribute(
		'src',
		DEFAULT_AVATAR_URL
	);
	const response = await page.request.get(DEFAULT_AVATAR_URL);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('image/svg+xml');
});

test('original and thumbnail variants preserve their bytes and cache validators', async ({
	page
}) => {
	await withRasterAvatar(page, async (source) => {
		const thumbnail = await page.request.get(THUMBNAIL_URL);
		expect(thumbnail.status()).toBe(200);
		expect(thumbnail.headers()['content-type']).toBe('image/webp');
		expect((await thumbnail.body()).byteLength).toBeLessThan(source.byteLength);

		const original = await page.request.get(ORIGINAL_URL);
		expect(original.headers()['content-type']).toBe('image/png');
		expect(await original.body()).toEqual(source);
		const explicitOriginal = await page.request.get(`${ORIGINAL_URL}?thumbnail=false`);
		expect(await explicitOriginal.body()).toEqual(source);

		for (const [url, response] of [
			[ORIGINAL_URL, original],
			[THUMBNAIL_URL, thumbnail]
		] as const) {
			const notModified = await page.request.get(url, {
				headers: { 'if-none-match': response.headers()['etag'] }
			});
			expect(notModified.status()).toBe(304);
		}
	});
});

test('pages download thumbnails without JavaScript on mobile and desktop', async ({ page }) => {
	await withRasterAvatar(page, async () => {
		const imageRequests: string[] = [];
		page.on('request', (request) => {
			if (request.resourceType() === 'image') imageRequests.push(new URL(request.url()).pathname);
		});
		const appointment = await seedAppointment();
		const pages = [
			{ path: '/', avatars: 1 },
			{ path: '/schedule/chat', avatars: 2 },
			{
				path: `/appointment/${appointment.id}/reschedule?token=${appointment.cancel_token}`,
				avatars: 2
			}
		];
		for (const width of [390, 1280]) {
			await page.setViewportSize({ width, height: 900 });
			for (const scenario of pages) {
				await page.goto(scenario.path);
				await expectPageAvatars(page, scenario.avatars);
			}
		}
		expect(imageRequests).toContain(ORIGINAL_URL);
		expect(imageRequests).not.toContain('/public/avatar%20source%20test.png');
	});
});

test('avatar paths cannot select another public image or recurse into this route', async ({
	page
}) => {
	await withRasterAvatar(page, async (source) => {
		const otherFile = join(workerDirectory(), 'public/not-configured.png');
		try {
			await writeFile(otherFile, source);
			expect((await page.request.get('/public/not-configured.png')).status()).toBe(200);
			for (const search of ['', '?thumbnail=true']) {
				expect(
					(await page.request.get(`/avatar/public/not-configured.png${search}`)).status()
				).toBe(404);
			}
			expect((await page.request.get('/avatar')).status()).toBe(404);

			await setAvatarSource(page, '/%61vatar');
			for (const search of ['', '?thumbnail=true']) {
				const rejected = await page.request.get(`/avatar/%61vatar${search}`, { timeout: 5_000 });
				expect(rejected.status()).toBe(404);
			}
		} finally {
			await rm(otherFile, { force: true });
		}
	});
});
