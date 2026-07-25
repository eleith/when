import type { Page } from '@playwright/test';

// Matches auth.credentials in the fixture config.
export const ADMIN = { username: 'admin', password: 'e2e-admin-password' };

export async function signInAsAdmin(page: Page): Promise<void> {
	await page.goto('/signin');
	await page.getByLabel('Username').fill(ADMIN.username);
	await page.getByLabel('Password').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL('**/admin');
}
