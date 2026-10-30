import { expect, test, type Page } from './support/test.ts';
import { signInAsAdmin } from './support/auth.ts';

function collectCspViolations(page: Page): string[] {
	const violations: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) {
			violations.push(msg.text());
		}
	});
	return violations;
}

test('the booking page sends the security headers', async ({ request }) => {
	const response = await request.get('/schedule/chat');
	const headers = response.headers();

	expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
	expect(
		headers['content-security-policy'].split(';').map((directive) => directive.trim())
	).toContain("form-action 'self' https://accounts.google.com");
});

test('booking forms check browser Origin against the same trusted scheme and Host', async ({
	baseURL,
	request
}) => {
	const form = { slot: 'not-a-slot' };
	const headers = { origin: baseURL!, accept: 'application/json' };
	const sameOrigin = await request.post('/schedule/chat', {
		form,
		headers,
		maxRedirects: 0
	});
	expect(sameOrigin.status()).toBe(400);
	expect(await sameOrigin.json()).toMatchObject({
		type: 'failure',
		status: 400,
		data: expect.stringContaining('Please pick a time slot.')
	});

	// Change only browser Origin, not the trusted request scheme or authority.
	const foreignHeaders = { ...headers, origin: 'https://foreign.example.test' };
	const foreignOrigin = await request.post('/schedule/chat', {
		form,
		headers: foreignHeaders,
		maxRedirects: 0
	});
	expect(foreignOrigin.status()).toBe(403);

	// No body/form option: Playwright must not add a Content-Type header.
	const missingContentType = await request.post('/schedule/chat', {
		headers: foreignHeaders,
		maxRedirects: 0
	});
	expect(missingContentType.status()).toBe(403);
});

test('the booking page renders and hydrates under the policy', async ({ page }) => {
	const violations = collectCspViolations(page);

	await page.goto('/schedule/chat');

	const primary = await page.evaluate(() =>
		getComputedStyle(document.documentElement).getPropertyValue('--when-color-primary').trim()
	);
	expect(primary).not.toBe('');

	// Month navigation is client-side, so a changed heading proves the calendar hydrated.
	// Deliberately not a booking flow: this test is about the policy, and picking a day
	// would tie it to whether the fixture's schedule has a slot left today.
	const month = page.getByRole('heading', { level: 2 });
	const opening = await month.textContent();
	await page.getByRole('button', { name: 'Next' }).click();
	await expect(month).not.toHaveText(opening ?? '');

	expect(violations).toEqual([]);
});

test('an admin page renders and hydrates under the policy', async ({ page }) => {
	const violations = collectCspViolations(page);

	await signInAsAdmin(page);

	const response = await page.request.get('/admin');
	expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');

	// A server-rendered page alone would still pass with hydration blocked by CSP.
	await page.getByRole('button', { name: 'Switch to dark theme' }).click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	expect(violations).toEqual([]);
});
