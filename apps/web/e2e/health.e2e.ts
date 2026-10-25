import { expect, test, type Locator, type Page } from './support/test.ts';
import { signInAsAdmin } from './support/auth.ts';

test('an unreachable worker shows plain SMTP test feedback without retrying', async ({ page }) => {
	await signInAsAdmin(page);
	await page.goto('/admin/health');

	let emailPosts = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().endsWith('/admin/health?/email')) {
			emailPosts++;
		}
	});

	const smtpCard = page.locator('.card').filter({
		has: page.getByRole('heading', { name: 'smtp.example.test', exact: true })
	});
	const form = smtpCard.locator('form.email-form');
	await expect(form).toHaveAttribute('action', '?/email');
	await expect(form.getByRole('textbox')).toHaveValue('e2e@example.test');
	await form.getByRole('button', { name: 'Send', exact: true }).click();

	const feedback = smtpCard.getByRole('status');
	await expect(feedback).toHaveText('Worker not reachable.');
	await expect(feedback).toHaveClass(/\bemail-result\b/);
	await expect(smtpCard.getByRole('alert')).toHaveCount(0);
	const status = smtpCard
		.locator('dt')
		.filter({ hasText: /^Status$/ })
		.locator('+ dd');
	await expect(status).toHaveText('not observed');
	await expect(form.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
	expect(emailPosts).toBe(1);
});

test('an unreachable worker shows provider auth feedback only on its card without retrying', async ({
	page
}) => {
	await signInAsAdmin(page);
	await page.goto('/admin/health');

	let providerPosts = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().endsWith('/admin/health?/testProvider')) {
			providerPosts++;
		}
	});

	const providerCard = page.locator('.card').filter({
		has: page.getByRole('heading', { name: 'fixture-service', exact: true })
	});
	const otherProviderCard = page.locator('.card').filter({
		has: page.getByRole('heading', { name: 'fixture-video', exact: true })
	});
	const form = providerCard.locator("form[action='?/testProvider']");
	await form.getByRole('button', { name: 'Test', exact: true }).click();

	const feedback = providerCard.getByRole('status');
	await expect(feedback).toHaveText('Worker not reachable.');
	await expect(feedback).toHaveClass(/\bprovider-test-result\b/);
	await expect(providerCard.getByRole('alert')).toHaveCount(0);
	const status = providerCard
		.locator('dt')
		.filter({ hasText: /^Status$/ })
		.locator('+ dd');
	await expect(status).toHaveText('not observed');
	await expect(otherProviderCard.getByRole('status')).toHaveCount(0);
	await expect(form.getByRole('button', { name: 'Test', exact: true })).toBeEnabled();
	expect(providerPosts).toBe(1);
});

test('an unreachable worker shows calendar test feedback without changing refresh health or retrying', async ({
	page
}) => {
	await signInAsAdmin(page);
	await page.goto('/admin/health');

	let calendarPosts = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().endsWith('/admin/health?/testCalendar')) {
			calendarPosts++;
		}
	});

	const calendarCard = page.locator('.card').filter({
		has: page.getByRole('heading', { name: 'main', exact: true })
	});
	const status = calendarCard
		.locator('dt')
		.filter({ hasText: /^Status$/ })
		.locator('+ dd');
	const lastRefresh = calendarCard
		.locator('dt')
		.filter({ hasText: /^Last refresh$/ })
		.locator('+ dd');
	await expect(status).toHaveText('refresh freshness unknown');
	const refreshBefore = await lastRefresh.innerText();
	const form = calendarCard.locator("form[action='?/testCalendar']");
	await expect(form.locator('input[name="calendar"]')).toHaveValue('main');
	const button = form.getByRole('button', { name: 'Test', exact: true });
	await button.click();

	const feedback = calendarCard.getByRole('status');
	await expect(feedback).toHaveText('Worker not reachable.');
	await expect(feedback).toHaveClass(/\bcalendar-test-result\b/);
	await expect(feedback).toHaveClass(/\bfeedback-error\b/);
	await expect(calendarCard.getByRole('alert')).toHaveCount(0);
	await expect(status).toHaveText('refresh freshness unknown');
	await expect(lastRefresh).toHaveText(refreshBefore);
	await expect(calendarCard.locator('.failed')).toHaveCount(0);
	await expect(button).toBeEnabled();
	expect(calendarPosts).toBe(1);
});

async function feedbackStyle(feedback: Locator) {
	const appearance = await feedback.evaluate((element) => {
		const style = getComputedStyle(element);
		const secondary = element.closest('.card')!.querySelector('dd')!;
		return {
			style: {
				fontFamily: style.fontFamily,
				fontSize: style.fontSize,
				fontWeight: style.fontWeight,
				lineHeight: style.lineHeight,
				padding: style.padding,
				background: style.backgroundColor,
				border: style.borderTop,
				color: style.color
			},
			secondaryColor: getComputedStyle(secondary).color
		};
	});
	expect(appearance.style.color).toBe(appearance.secondaryColor);
	return appearance.style;
}

async function feedbackThemes(page: Page, feedback: Locator) {
	await expect(feedback).toHaveText('Worker not reachable.');
	await expect(feedback).toHaveClass(/\bfeedback-error\b/);
	await page.emulateMedia({ colorScheme: 'light' });
	const light = await feedbackStyle(feedback);
	await page.emulateMedia({ colorScheme: 'dark' });
	const dark = await feedbackStyle(feedback);
	await page.emulateMedia({ colorScheme: 'light' });
	return { light, dark };
}

test('unreachable discovery settles with consistent error feedback, not an empty calendar list', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.emulateMedia({ colorScheme: 'light' });
	await signInAsAdmin(page);
	await page.goto('/admin/health');

	const card = (name: string) =>
		page.locator('.card').filter({
			has: page.getByRole('heading', { name, exact: true })
		});
	const providerCard = card('fixture-service');
	const otherProviderCard = card('fixture-video');
	const smtpCard = card('smtp.example.test');
	const calendarCard = card('main');

	// Each real action replaces the last result; compare its computed styles before moving on.
	await smtpCard.getByRole('button', { name: 'Send', exact: true }).click();
	const smtpStyles = await feedbackThemes(page, smtpCard.getByRole('status'));
	await providerCard.locator("form[action='?/testProvider'] button").click();
	const providerStyles = await feedbackThemes(page, providerCard.getByRole('status'));
	expect(providerStyles).toEqual(smtpStyles);
	await calendarCard.locator("form[action='?/testCalendar'] button").click();
	const calendarStyles = await feedbackThemes(page, calendarCard.getByRole('status'));
	expect(calendarStyles).toEqual(smtpStyles);

	let discoveryPosts = 0;
	const isDiscovery = (url: URL) => url.pathname === '/admin/health' && url.search === '?/discover';
	page.on('request', (request) => {
		if (request.method() === 'POST' && isDiscovery(new URL(request.url()))) discoveryPosts++;
	});
	// Hold only the browser's POST, then let the fixture server produce the actual failure.
	const gate = Promise.withResolvers<void>();
	await page.route(isDiscovery, async (route) => {
		await gate.promise;
		await route.continue();
	});
	const form = providerCard.locator("form[action='?/discover']");
	await expect(form.locator('input[name="provider"]')).toHaveValue('fixture-service');
	const button = form.getByRole('button', { name: 'List calendars', exact: true });
	const requestStarted = page.waitForRequest(
		(request) => request.method() === 'POST' && isDiscovery(new URL(request.url()))
	);
	try {
		await button.click();
		const request = await requestStarted;
		expect(request.method()).toBe('POST');
		await expect(button).toBeDisabled();
		await expect(button.locator('.spinner')).toBeVisible();
		await expect(providerCard.locator('.found')).toHaveCount(0);
	} finally {
		gate.resolve();
	}

	const feedback = providerCard.getByRole('status');
	await expect(feedback).toHaveClass(/\bdiscovery-result\b/);
	const discoveryStyles = await feedbackThemes(page, feedback);
	expect(discoveryStyles).toEqual(smtpStyles);
	await expect(button).toBeEnabled();
	await expect(button.locator('.spinner')).toHaveCount(0);
	await expect(button).not.toHaveClass(/\bbusy\b/);
	await expect(providerCard.locator('.found')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Available calendars', exact: true })).toHaveCount(
		0
	);
	await expect(page.getByText('This provider exposes no calendars.', { exact: true })).toHaveCount(
		0
	);
	await expect(page.getByText(/Asking/)).toHaveCount(0);
	await expect(providerCard.getByRole('alert')).toHaveCount(0);
	await expect(
		providerCard
			.locator('dt')
			.filter({ hasText: /^Status$/ })
			.locator('+ dd')
	).toHaveText('not observed');
	await expect(otherProviderCard.getByRole('status')).toHaveCount(0);
	await expect(otherProviderCard.getByRole('alert')).toHaveCount(0);
	await expect(
		otherProviderCard.getByRole('button', { name: 'List calendars', exact: true })
	).toBeEnabled();
	await expect(otherProviderCard.getByRole('button', { name: 'Test', exact: true })).toBeEnabled();
	expect(discoveryPosts).toBe(1);

	await page.screenshot({
		path: testInfo.outputPath('health-feedback-desktop.png'),
		fullPage: true
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ colorScheme: 'dark' });
	const mobileStyle = await feedbackStyle(feedback);
	expect(mobileStyle).toEqual(discoveryStyles.dark);
	const dimensions = await page.evaluate(() => ({
		content: document.documentElement.scrollWidth,
		viewport: document.documentElement.clientWidth
	}));
	expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
	await page.screenshot({
		path: testInfo.outputPath('health-feedback-mobile.png'),
		fullPage: true
	});
	expect(discoveryPosts).toBe(1);
});
