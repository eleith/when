import { expect, test, type Page } from './support/test.ts';
import { CHAT_MEETING } from './support/seed.ts';

type ProbedWindow = typeof window & { timezoneBuilds: number };

async function trackTimezoneBuilds(page: Page, options: { failFirst?: boolean } = {}) {
	await page.addInitScript(({ failFirst }) => {
		const probe = window as ProbedWindow;
		probe.timezoneBuilds = 0;
		const supportedValuesOf = Intl.supportedValuesOf.bind(Intl);
		Intl.supportedValuesOf = (key) => {
			if (key === 'timeZone') {
				probe.timezoneBuilds++;
				if (failFirst && probe.timezoneBuilds === 1) throw new Error('Timezone lookup failed');
			}
			return supportedValuesOf(key);
		};
	}, options);
}

const buildCount = (page: Page) => page.evaluate(() => (window as ProbedWindow).timezoneBuilds);

for (const width of [390, 1280]) {
	test(`timezone indexing is first-open only and stays usable while loading at ${width}px`, async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await trackTimezoneBuilds(page);
		const now = new Date();
		await page.clock.install({ time: now });
		await page.goto(`/schedule/${CHAT_MEETING.slug}`);
		const trigger = page.getByRole('button', { name: /^Change timezone, currently/ });
		await expect(trigger).toBeVisible();
		await page.clock.pauseAt(new Date(now.getTime() + 60_000));
		expect(await buildCount(page)).toBe(0);

		const requests: string[] = [];
		page.on('request', (request) => {
			if (['fetch', 'xhr'].includes(request.resourceType())) requests.push(request.url());
		});
		await trigger.click();
		const dialog = page.getByRole('dialog', { name: 'Choose timezone' });
		const search = dialog.getByRole('searchbox', { name: 'Search timezones' });
		const loading = dialog.getByRole('status').filter({ hasText: 'Loading timezones…' });
		await expect(loading).toBeVisible();
		await page.clock.runFor(16);
		await expect(loading).toBeVisible();
		await expect(search).toBeFocused();
		expect(await buildCount(page)).toBe(1);
		const loadingHeight = (await dialog.boundingBox())!.height;

		// Typing and closing must work before initialization completes.
		await search.fill('Tokyo');
		await expect(dialog.getByText('No matches', { exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');
		// Bits UI finishes closing through animation frames, even with reduced motion.
		await page.clock.runFor(32);
		await expect(dialog).not.toBeVisible();
		await trigger.click();
		await expect(loading).toBeVisible();
		await expect(search).toHaveValue('Tokyo');
		expect(await buildCount(page)).toBe(1);
		const close = dialog.getByRole('button', { name: 'Close', exact: true });
		await close.focus();

		await expect
			.poll(async () => {
				await page.clock.runFor(32);
				return loading.count();
			})
			.toBe(0);
		await expect(close).toBeFocused();
		await expect(dialog.locator('.tz-option')).toHaveCount(1);
		expect((await dialog.boundingBox())!.height).toBe(loadingHeight);
		expect(requests).toEqual([]);
		await dialog.getByRole('button', { name: /^Tokyo/ }).click();
		await page.clock.runFor(32);
		await expect(dialog).not.toBeVisible();
		await expect(trigger).toHaveAccessibleName(/currently Tokyo/);
		const cookies = await context.cookies();
		expect(decodeURIComponent(cookies.find((cookie) => cookie.name === 'tz')!.value)).toBe(
			'Asia/Tokyo'
		);

		await trigger.click();
		await expect(dialog).toBeVisible();
		await expect(loading).toHaveCount(0);
		await expect(search).toHaveValue('');
		await expect(dialog.locator('.tz-option.selected')).toContainText('Tokyo');
		expect(await buildCount(page)).toBe(1);
	});
}

test('a failed timezone lookup offers a retry without breaking the booking page', async ({
	page
}) => {
	await trackTimezoneBuilds(page, { failFirst: true });
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(`/schedule/${CHAT_MEETING.slug}`);
	const trigger = page.getByRole('button', { name: /^Change timezone, currently/ });
	await expect(trigger).toBeVisible();
	expect(await buildCount(page)).toBe(0);
	await trigger.click();
	const dialog = page.getByRole('dialog', { name: 'Choose timezone' });
	await expect(dialog.getByRole('status')).toHaveText('Couldn’t load timezones.');
	expect(await buildCount(page)).toBe(1);
	await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
	const search = dialog.getByRole('searchbox', { name: 'Search timezones' });
	await expect(search).toBeFocused();
	await search.fill('PST');
	await expect(dialog.getByRole('button', { name: /^Los Angeles/ })).toBeVisible();
	expect(await buildCount(page)).toBe(2);
	await page.keyboard.press('Escape');
	await expect(trigger).toBeFocused();
	expect(errors).toEqual([]);
});
