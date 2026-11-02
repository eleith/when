import { expect, test, type Page, type Locator } from './support/test.ts';
import { CHAT_MEETING } from './support/seed.ts';

const STORAGE_KEY = 'when.navigation-pending';
const progressBar = (page: Page) => page.getByRole('progressbar', { name: 'Loading page' });
const themeButton = (page: Page) =>
	page.getByRole('button', {
		name: /^(Switch to dark theme|Switch to light theme|Use system theme)$/
	});

type ProgressProbe = { incoming: string | null; seen: boolean };
type ObservedWindow = typeof window & { progressProbe: ProgressProbe };

async function openWithPausedClock(page: Page) {
	const noon = new Date();
	noon.setUTCHours(12, 0, 0, 0);
	await page.clock.install({ time: noon });
	await page.goto('/');
	await expect(themeButton(page)).toBeEnabled();
	await page.clock.pauseAt(new Date(noon.getTime() + 60_000));
	await expect(progressBar(page)).toHaveCount(0);
}

async function followLink(page: Page, link: Locator) {
	await link.focus();
	await page.keyboard.press('Enter');
	// Kit defers link navigation through RAF/timers; input alone cannot advance a paused clock.
	await page.clock.runFor(100);
}

async function holdPageLoad(page: Page, path: string) {
	const requested = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const dataPath = path === '/' ? '/__data.json' : `${path}/__data.json`;
	await page.route(
		(url) => url.pathname === dataPath,
		async (route) => {
			requested.resolve();
			await release.promise;
			await route.continue();
		},
		{ times: 1 }
	);
	return { requested: requested.promise, release: release.resolve };
}

async function fillScale(bar: Locator) {
	return bar
		.locator('.fill')
		.evaluate(
			(fill) =>
				fill.getBoundingClientRect().width / fill.parentElement!.getBoundingClientRect().width
		);
}

test('a new navigation survives the previous navigation finishing', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await openWithPausedClock(page);
	const bar = progressBar(page);
	const first = await holdPageLoad(page, '/schedule/chat');
	try {
		const link = page.getByRole('link', { name: CHAT_MEETING.title });
		await followLink(page, link);
		await first.requested;
		await expect(bar).toBeVisible();
		await expect(bar).not.toHaveAttribute('aria-valuenow');
		await expect(bar).toHaveCSS('pointer-events', 'none');
		await page.clock.runFor(300);
		const pendingScale = await fillScale(bar);
		expect(pendingScale).toBeGreaterThan(0.2);
		expect(pendingScale).toBeLessThan(0.9);
		first.release();
		await expect(page).toHaveURL('/schedule/chat');
		await page.clock.runFor(32);
		expect(await fillScale(bar)).toBeGreaterThan(pendingScale + 0.05);

		const second = await holdPageLoad(page, '/');
		try {
			const back = page.getByRole('link', { name: 'Back', exact: true });
			await followLink(page, back);
			await second.requested;
			await expect(bar).toBeVisible();
			// Virtual frames cross the old completion deadline while the next response is held.
			await page.clock.runFor(500);
			await expect(bar).toBeVisible();
			expect(await fillScale(bar)).toBeGreaterThan(0.2);
			expect(await fillScale(bar)).toBeLessThan(0.9);
			second.release();
			await expect(page).toHaveURL('/');
			await page.clock.runFor(450);
			await expect(bar).toHaveCount(0);
			expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
		} finally {
			second.release();
		}
	} finally {
		first.release();
	}
});

test('document transitions consume a fresh handoff and reject stale or invalid markers', async ({
	page
}) => {
	await openWithPausedClock(page);
	await page.addInitScript((key) => {
		const probe: ProgressProbe = { incoming: sessionStorage.getItem(key), seen: false };
		(window as ObservedWindow).progressProbe = probe;
		new MutationObserver(() => {
			if (document.querySelector('[role="progressbar"][aria-label="Loading page"]'))
				probe.seen = true;
		}).observe(document, { childList: true, subtree: true });
	}, STORAGE_KEY);
	await page.reload();
	await expect(themeButton(page)).toBeEnabled();
	const probe = await page.evaluate(() => (window as ObservedWindow).progressProbe);
	expect(Number.isFinite(Number(probe.incoming))).toBe(true);
	expect(probe.incoming).not.toBeNull();
	await expect
		.poll(() => page.evaluate(() => (window as ObservedWindow).progressProbe.seen))
		.toBe(true);
	expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
	await expect(progressBar(page)).toBeVisible();
	expect(await fillScale(progressBar(page))).toBeCloseTo(0.9, 2);
	await page.clock.runFor(250);
	await expect(progressBar(page)).toHaveCount(0);

	// Exercise the persisted-page consumer without depending on browser BFCache eligibility.
	await page.evaluate((key) => {
		sessionStorage.setItem(key, String(Date.now() - 5000));
		window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
	}, STORAGE_KEY);
	await expect(progressBar(page)).toBeVisible();
	expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
	await page.clock.runFor(250);
	await expect(progressBar(page)).toHaveCount(0);

	for (const marker of ['invalid', 'stale', 'future']) {
		await page.evaluate(
			({ key, marker }) => {
				(window as ObservedWindow).progressProbe.seen = false;
				let value = 'not-a-time';
				if (marker === 'stale') value = String(Date.now() - 5001);
				else if (marker === 'future') value = String(Date.now() + 1);
				sessionStorage.setItem(key, value);
				window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
			},
			{ key: STORAGE_KEY, marker }
		);
		await page.clock.runFor(32);
		await expect(progressBar(page)).toHaveCount(0);
		expect(await page.evaluate(() => (window as ObservedWindow).progressProbe.seen)).toBe(false);
		expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)).toBeNull();
	}
});

test('blocked handoff storage leaves reduced-motion navigation usable', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.addInitScript((blockedKey) => {
		const getItem = Storage.prototype.getItem;
		const setItem = Storage.prototype.setItem;
		const removeItem = Storage.prototype.removeItem;
		Storage.prototype.getItem = function (key) {
			if (key === blockedKey) throw new DOMException('Storage blocked', 'SecurityError');
			return getItem.call(this, key);
		};
		Storage.prototype.setItem = function (key, value) {
			if (key === blockedKey) throw new DOMException('Storage blocked', 'SecurityError');
			return setItem.call(this, key, value);
		};
		Storage.prototype.removeItem = function (key) {
			if (key === blockedKey) throw new DOMException('Storage blocked', 'SecurityError');
			return removeItem.call(this, key);
		};
	}, STORAGE_KEY);
	await openWithPausedClock(page);
	const held = await holdPageLoad(page, '/schedule/chat');
	try {
		const link = page.getByRole('link', { name: CHAT_MEETING.title });
		await followLink(page, link);
		await held.requested;
		const bar = progressBar(page);
		await expect(bar).toBeVisible();
		await expect(bar).not.toHaveAttribute('aria-valuenow');
		const scale = await fillScale(bar);
		expect(scale).toBeCloseTo(0.9, 2);
		await page.clock.runFor(1000);
		expect(await fillScale(bar)).toBeCloseTo(scale, 5);
		const bounds = await bar.boundingBox();
		expect(bounds!.x).toBe(0);
		expect(bounds!.y).toBe(0);
		expect(bounds!.width).toBe(390);
		held.release();
		await expect(page).toHaveURL('/schedule/chat');
		await page.clock.runFor(450);
		await expect(bar).toHaveCount(0);
	} finally {
		held.release();
	}
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
	const back = page.getByRole('link', { name: 'Back', exact: true });
	await followLink(page, back);
	await expect(page).toHaveURL('/');
	await expect(themeButton(page)).toBeEnabled();
	await page.clock.runFor(450);
	await expect(progressBar(page)).toHaveCount(0);
	expect(errors).toEqual([]);
});
