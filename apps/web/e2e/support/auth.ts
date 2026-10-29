import type { Cookie, Page } from '@playwright/test';

// Matches auth.credentials in the fixture config.
export const ADMIN = { username: 'admin', password: 'e2e-admin-password' };

// Each worker has its own module state and server. Reuse only stateless auth cookies,
// never a test's theme/timezone preferences or other browser state.
const sessions = new Map<string, Cookie[]>();
const sessionCookie = /^(?:__Secure-)?better-auth\.session_(?:token|data)(?:\.\d+)?$/;

async function submitAdminForm(page: Page): Promise<void> {
	await page.getByLabel('Username').fill(ADMIN.username);
	await page.getByLabel('Password').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL('**/admin');
}

// Auth-critical coverage must exercise the real form, even when a session is cached.
export async function signInAsAdminViaForm(page: Page): Promise<void> {
	await page.goto('/signin');
	await submitAdminForm(page);
}

export async function signInAsAdmin(page: Page): Promise<void> {
	await page.goto('/signin');
	const origin = new URL(page.url()).origin;
	const cached = sessions.get(origin);
	if (cached) {
		await page.context().addCookies(cached);
		await page.goto('/admin');
		await page.waitForURL('**/admin');
		return;
	}

	await submitAdminForm(page);
	sessions.set(
		origin,
		(await page.context().cookies(origin)).filter((cookie) => sessionCookie.test(cookie.name))
	);
}
