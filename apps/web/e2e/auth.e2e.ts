import { expect, test } from './support/test.ts';
import { ADMIN, signInAsAdmin, signInAsAdminViaForm } from './support/auth.ts';

test('an admin page sends a signed-out visitor to sign in', async ({ page }) => {
	await page.goto('/admin');

	await expect(page).toHaveURL('/signin?callbackUrl=%2Fadmin');
});

test('an admin page refuses a signed-out non-browser request', async ({ request }) => {
	const response = await request.get('/admin', { headers: { accept: 'application/json' } });

	expect(response.status()).toBe(403);
});

test('Google connect refuses a signed-out same-origin POST', async ({ baseURL, request }) => {
	const response = await request.post('/admin/services/google/connect', {
		headers: { origin: baseURL!, accept: 'application/json' },
		form: { provider: 'fixture-google' },
		maxRedirects: 0
	});

	expect(response.status()).toBe(403);
	expect(await response.json()).toMatchObject({ message: 'Not authorized.' });
	expect(response.headers()['set-cookie'] ?? '').not.toContain('when_google_oauth=');
});

test('Google connect redirects to consent with the callback and nonce cookie', async ({
	baseURL,
	page
}) => {
	await signInAsAdmin(page);
	// Inspect only the redirect: never follow it to Google or exchange a code.
	const response = await page.request.post('/admin/services/google/connect', {
		headers: { origin: baseURL! },
		form: { provider: 'fixture-google' },
		maxRedirects: 0
	});

	expect(response.status()).toBe(303);
	const consent = new URL(response.headers().location);
	expect(consent.origin).toBe('https://accounts.google.com');
	expect(consent.searchParams.get('client_id')).toBe('e2e-google-client');
	expect(consent.searchParams.get('redirect_uri')).toBe(
		`${baseURL}/admin/services/google/callback`
	);
	const state = consent.searchParams.get('state');
	expect(state).toBeTruthy();

	const stateCookies = response
		.headersArray()
		.filter(
			({ name, value }) =>
				name.toLowerCase() === 'set-cookie' && value.startsWith('when_google_oauth=')
		);
	expect(stateCookies).toHaveLength(1);
	const cookie = stateCookies[0].value;
	const value = cookie.split(';')[0].slice('when_google_oauth='.length);
	expect(JSON.parse(decodeURIComponent(value))).toEqual({ state, service: 'fixture-google' });
	expect(cookie).toContain('Path=/admin');
	expect(cookie).toContain('HttpOnly');
	expect(cookie).toContain('SameSite=Lax');
});

test('the wrong password is rejected', async ({ page }) => {
	await page.goto('/signin');
	await page.getByLabel('Username').fill(ADMIN.username);
	await page.getByLabel('Password').fill('not-the-password');
	await page.getByRole('button', { name: 'Sign in' }).click();

	await expect(page.getByRole('alert')).toContainText('Invalid username or password');
	await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
	await expect(page).not.toHaveURL('/admin');
});

test('a retired sign-in callback does not turn successful authentication into a network error', async ({
	page
}) => {
	// Keep this extra real-form login independent of the production per-IP limiter.
	await page.setExtraHTTPHeaders({ 'x-real-ip': '192.0.2.200' });
	await page.goto('/signin?callbackUrl=%2Fretired-page');
	await page.getByLabel('Username').fill(ADMIN.username);
	await page.getByLabel('Password').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();

	await expect(page).toHaveURL('/retired-page');
	await expect(page.locator('.signin-form')).toHaveCount(0);
	const admin = await page.request.get('/admin', { maxRedirects: 0 });
	expect(admin.status()).toBe(200);
});

test('the fixture credentials reach the admin dashboard without a pending banner flash', async ({
	page
}) => {
	let releaseLogin!: () => void;
	const waiting = new Promise<void>((resolve) => {
		releaseLogin = resolve;
	});
	await page.route('**/auth/sign-in/credentials', async (route) => {
		await waiting;
		await route.continue();
	});

	const signingIn = signInAsAdminViaForm(page);
	try {
		await expect(page.locator('.signin-form')).toHaveAttribute('aria-busy', 'true');
		await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
		await expect(page.locator('.error-banner')).toHaveCount(0);
	} finally {
		releaseLogin();
		await signingIn;
	}
	await expect(page).toHaveURL('/admin');
});
