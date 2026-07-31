import { expect, test, type Page } from '@playwright/test';
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
	expect(violations).toEqual([]);
});
