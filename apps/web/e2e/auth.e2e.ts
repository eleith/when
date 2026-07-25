import { expect, test } from '@playwright/test';
import { ADMIN, signInAsAdmin } from './support/auth.ts';

test('an admin page sends a signed-out visitor to sign in', async ({ page }) => {
	await page.goto('/admin');

	await expect(page).toHaveURL('/signin?callbackUrl=%2Fadmin');
});

test('an admin page refuses a signed-out non-browser request', async ({ request }) => {
	const response = await request.get('/admin', { headers: { accept: 'application/json' } });

	expect(response.status()).toBe(403);
});

test('the wrong password is rejected', async ({ page }) => {
	await page.goto('/signin');
	await page.getByLabel('Username').fill(ADMIN.username);
	await page.getByLabel('Password').fill('not-the-password');
	await page.getByRole('button', { name: 'Sign in' }).click();

	await expect(page.getByRole('alert')).toContainText('Invalid username or password');
	await expect(page).not.toHaveURL('/admin');
});

test('the fixture credentials reach the admin dashboard', async ({ page }) => {
	await signInAsAdmin(page);

	await expect(page).toHaveURL('/admin');
});
