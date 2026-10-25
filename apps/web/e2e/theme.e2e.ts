import { expect, test, type Locator, type Page } from './support/test.ts';
import { signInAsAdmin } from './support/auth.ts';
import { CHAT_MEETING, seedAppointment } from './support/seed.ts';

function themeButton(page: Page): Locator {
	return page.getByRole('button', {
		name: /^(Switch to dark theme|Switch to light theme|Use system theme)$/
	});
}

async function palette(page: Page) {
	const colors = await page.evaluate(() => {
		const body = getComputedStyle(document.body);
		const card = getComputedStyle(document.querySelector('.event-card')!);
		return { background: body.backgroundColor, text: body.color, card: card.backgroundColor };
	});
	return colors;
}

async function touchTarget(button: Locator) {
	const bounds = await button.boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.width).toBe(44);
	expect(bounds!.height).toBe(44);
	return bounds!;
}

async function noHorizontalOverflow(page: Page) {
	const dimensions = await page.evaluate(() => ({
		content: document.documentElement.scrollWidth,
		viewport: document.documentElement.clientWidth
	}));
	expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
}

test('keyboard cycling saves the preference, not the resolved OS scheme', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/');
	const root = page.locator('html');
	const toggle = themeButton(page);
	await expect(root).toHaveAttribute('data-theme', 'system');
	await expect(toggle).toHaveAccessibleName('Switch to dark theme');
	await expect(toggle).toBeEnabled();
	const light = await palette(page);
	const toggleBounds = await touchTarget(toggle);
	const profileBounds = await page.locator('.profile').boundingBox();
	expect(profileBounds).not.toBeNull();
	expect(toggleBounds.x).toBeGreaterThanOrEqual(profileBounds!.x + profileBounds!.width);
	expect(Math.abs(toggleBounds.y - profileBounds!.y)).toBeLessThanOrEqual(1);
	await page.screenshot({
		path: testInfo.outputPath('theme-home-desktop-light.png'),
		fullPage: true
	});

	await page.emulateMedia({ colorScheme: 'dark' });
	await expect.poll(() => palette(page)).not.toEqual(light);
	const dark = await palette(page);
	expect(dark.background).not.toBe(light.background);
	expect(dark.card).not.toBe(light.card);
	await expect(root).toHaveAttribute('data-theme', 'system');
	await expect(toggle).toHaveAccessibleName('Switch to dark theme');

	await page.emulateMedia({ colorScheme: 'light' });
	await expect.poll(() => palette(page)).toEqual(light);
	await toggle.focus();
	await page.keyboard.press('Enter');
	await expect(root).toHaveAttribute('data-theme', 'dark');
	await expect(toggle).toHaveAccessibleName('Switch to light theme');
	await expect.poll(() => palette(page)).toEqual(dark);
	const storedDark = await page.evaluate(() => localStorage.getItem('when.theme'));
	expect(storedDark).toBe('dark');

	await page.reload();
	await expect(root).toHaveAttribute('data-theme', 'dark');
	await expect(toggle).toHaveAccessibleName('Switch to light theme');
	await expect(toggle).toBeEnabled();
	await expect.poll(() => palette(page)).toEqual(dark);
	await page.emulateMedia({ colorScheme: 'dark' });
	await toggle.focus();
	await page.keyboard.press('Space');
	await expect(root).toHaveAttribute('data-theme', 'light');
	await expect(toggle).toHaveAccessibleName('Use system theme');
	await expect.poll(() => palette(page)).toEqual(light);
	const storedLight = await page.evaluate(() => localStorage.getItem('when.theme'));
	expect(storedLight).toBe('light');

	await page.keyboard.press('Enter');
	await expect(root).toHaveAttribute('data-theme', 'system');
	await expect(toggle).toHaveAccessibleName('Switch to dark theme');
	await expect.poll(() => palette(page)).toEqual(dark);
	const storedSystem = await page.evaluate(() => localStorage.getItem('when.theme'));
	expect(storedSystem).toBe('system');
	await page.emulateMedia({ colorScheme: 'light' });
	await expect.poll(() => palette(page)).toEqual(light);
	await expect(root).toHaveAttribute('data-theme', 'system');
});

test('the chosen palette carries through booking, guest links, sign in and admin navigation', async ({
	page
}) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/');
	await themeButton(page).click();
	const dark = await palette(page);
	await page.getByRole('link', { name: CHAT_MEETING.title }).click();
	await expect(page).toHaveURL('/schedule/chat');
	await expect(themeButton(page)).toHaveCount(0);
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(page.locator('body')).toHaveCSS('background-color', dark.background);

	const appointment = await seedAppointment();
	await page.goto(`/appointment/${appointment.id}?token=${appointment.cancel_token}`);
	await expect(page.getByRole('heading', { name: CHAT_MEETING.title })).toBeVisible();
	await expect(themeButton(page)).toHaveCount(0);
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(page.locator('body')).toHaveCSS('background-color', dark.background);

	await page.goto('/signin');
	await expect(themeButton(page)).toHaveCount(0);
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(page.locator('body')).toHaveCSS('background-color', dark.background);
	await expect(page.locator('.signin-card')).toHaveCSS('background-color', dark.card);
	await signInAsAdmin(page);
	await expect(themeButton(page)).toHaveAccessibleName('Switch to light theme');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(page.locator('body')).toHaveCSS('background-color', dark.background);
	const homepage = page.getByRole('link', { name: 'Homepage', exact: true });
	await expect(homepage).toHaveAttribute('href', '/');
	await touchTarget(homepage);
	await expect(page.getByRole('navigation', { name: 'Admin breadcrumb' })).toHaveText('');
	await homepage.click();
	await expect(page).toHaveURL('/');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(themeButton(page)).toHaveAccessibleName('Switch to light theme');
	await page.getByRole('link', { name: 'Admin dashboard', exact: true }).click();
	await expect(page).toHaveURL('/admin');

	await page.locator('a[href="/admin/health#calendars"]').click();
	await expect(page).toHaveURL('/admin/health#calendars');
	await expect(page.getByRole('navigation', { name: 'Admin breadcrumb' })).toHaveText('Health');
	await expect(page.getByRole('link', { name: 'Admin dashboard', exact: true })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.getByRole('link', { name: 'Admin dashboard', exact: true }).click();
	await expect(page).toHaveURL('/admin');
	await expect(themeButton(page)).toHaveAccessibleName('Switch to light theme');
});

test('system colors follow the OS even on a route without a theme button', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/');
	const light = await palette(page);
	await page.emulateMedia({ colorScheme: 'dark' });
	await expect.poll(() => palette(page)).not.toEqual(light);
	const dark = await palette(page);
	await page.getByRole('link', { name: CHAT_MEETING.title }).click();
	await expect(themeButton(page)).toHaveCount(0);
	await expect(page.locator('body')).toHaveCSS('background-color', dark.background);
	await page.emulateMedia({ colorScheme: 'light' });
	await expect(page.locator('body')).toHaveCSS('background-color', light.background);
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
	await page.emulateMedia({ colorScheme: 'dark' });
	await expect(page.locator('body')).toHaveCSS('background-color', dark.background);
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
	await expect(themeButton(page)).toHaveCount(0);
});

test('an invalid stored preference falls back to system', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.addInitScript(() => localStorage.setItem('when.theme', 'not-a-theme'));
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
	await expect(themeButton(page)).toHaveAccessibleName('Switch to dark theme');
	await expect(themeButton(page)).toBeEnabled();
	const dark = await palette(page);
	await page.emulateMedia({ colorScheme: 'light' });
	await expect.poll(() => palette(page)).not.toEqual(dark);
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
	await themeButton(page).click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect.poll(() => palette(page)).toEqual(dark);
	const saved = await page.evaluate(() => localStorage.getItem('when.theme'));
	expect(saved).toBe('dark');
});

test('blocked theme storage still allows cycling and preserves the choice across SPA navigation', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.addInitScript(() => {
		const getItem = Storage.prototype.getItem;
		const setItem = Storage.prototype.setItem;
		Storage.prototype.getItem = function (key) {
			if (key === 'when.theme') throw new DOMException('Storage blocked', 'SecurityError');
			return getItem.call(this, key);
		};
		Storage.prototype.setItem = function (key, value) {
			if (key === 'when.theme') throw new DOMException('Storage blocked', 'SecurityError');
			setItem.call(this, key, value);
		};
	});
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
	await themeButton(page).click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	const dark = await palette(page);
	await page.getByRole('link', { name: CHAT_MEETING.title }).click();
	await expect(themeButton(page)).toHaveCount(0);
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(page.locator('body')).toHaveCSS('background-color', dark.background);
	await page.goBack();
	await expect(page).toHaveURL('/');
	await expect(themeButton(page)).toHaveAccessibleName('Switch to light theme');
	await themeButton(page).click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	await themeButton(page).click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
	expect(errors).toEqual([]);
});

test('the nonced head bootstrap applies the saved palette without hydration', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/');
	await themeButton(page).click();
	const dark = await palette(page);
	await page.addInitScript(() => localStorage.setItem('when.theme', 'dark'));
	const violations: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
			violations.push(message.text());
		}
	});
	// Keep HTML, CSS and the inline bootstrap; withhold only the hydration modules.
	await page.route(/\/_app\/immutable\/.*\.js(?:\?|$)/, (route) => route.abort());
	const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
	expect(response).not.toBeNull();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(page.locator('body')).toHaveCSS('background-color', dark.background);
	await expect(page.locator('.event-card')).toHaveCSS('background-color', dark.card);
	await expect(themeButton(page)).toBeDisabled();

	const nonce = await page.evaluate(() => {
		const scripts = document.querySelectorAll<HTMLScriptElement>('head script');
		const bootstrap = Array.from(scripts).find((script) =>
			script.textContent?.includes('when.theme')
		);
		return bootstrap?.nonce ?? '';
	});
	expect(nonce).not.toBe('');
	const policy = response!.headers()['content-security-policy'];
	expect(policy).toContain(`'nonce-${nonce}'`);
	const scriptPolicy = policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)?.[1];
	expect(scriptPolicy).toBeDefined();
	expect(scriptPolicy).not.toContain("'unsafe-inline'");
	expect(scriptPolicy).not.toContain("'unsafe-eval'");
	expect(policy).toContain("frame-ancestors 'none'");
	expect(violations).toEqual([]);
});

test('admin icon actions stay ordered, tappable and separate from the real sign-out form', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.emulateMedia({ colorScheme: 'dark' });
	await signInAsAdmin(page);
	const toggle = themeButton(page);
	const signout = page.getByRole('button', { name: 'Sign out', exact: true });
	await expect(toggle).toBeEnabled();
	await expect(toggle).toHaveAttribute('type', 'button');
	await expect(signout).toHaveText('');
	await expect(signout.locator('svg')).toHaveCount(1);
	await expect(toggle.locator('svg')).toHaveCount(1);
	await expect(toggle.locator('svg text')).toHaveCount(0);
	await expect(page.getByRole('navigation', { name: 'Admin breadcrumb' })).toHaveText('');
	await expect(page.locator('.nav-actions > button + form')).toHaveAttribute(
		'action',
		'/admin?/signout'
	);
	await expect(page.locator('.signout-form')).toHaveAttribute('method', 'POST');
	const toggleBounds = await touchTarget(toggle);
	const signoutBounds = await touchTarget(signout);
	expect(toggleBounds.x + toggleBounds.width).toBeLessThanOrEqual(signoutBounds.x);
	expect(signoutBounds.x - toggleBounds.x - toggleBounds.width).toBeLessThanOrEqual(16);
	await page.screenshot({
		path: testInfo.outputPath('theme-admin-desktop-dark.png'),
		fullPage: true
	});

	let signoutPosts = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().endsWith('/admin?/signout')) signoutPosts++;
	});
	await toggle.click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await toggle.click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	await expect(page).toHaveURL('/admin');
	expect(signoutPosts).toBe(0);

	await page.setViewportSize({ width: 390, height: 844 });
	await touchTarget(toggle);
	await touchTarget(signout);
	await noHorizontalOverflow(page);
	await page.screenshot({
		path: testInfo.outputPath('theme-admin-mobile-light.png'),
		fullPage: true
	});
	await page.goto('/');
	await expect(toggle).toHaveAccessibleName('Use system theme');
	await touchTarget(toggle);
	await noHorizontalOverflow(page);
	await page.screenshot({
		path: testInfo.outputPath('theme-home-mobile-light.png'),
		fullPage: true
	});

	await page.setViewportSize({ width: 320, height: 844 });
	await page.goto('/admin/services/google/callback');
	await expect(page.getByRole('navigation', { name: 'Admin breadcrumb' })).toHaveText(
		'Google authorization'
	);
	await touchTarget(toggle);
	await touchTarget(signout);
	await noHorizontalOverflow(page);

	await page.goto('/admin/health?view=theme');
	await expect(page.getByRole('navigation', { name: 'Admin breadcrumb' })).toHaveText('Health');
	await signout.click();
	await expect(page).toHaveURL('/signin?callbackUrl=%2Fadmin%2Fhealth%3Fview%3Dtheme');
	expect(signoutPosts).toBe(1);
	await expect(themeButton(page)).toHaveCount(0);
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
