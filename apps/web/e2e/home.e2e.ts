import { expect, test } from '@playwright/test';

test('home page renders', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveTitle(/./);
});

test('schedule page with unavailable date deep link does not throw router initialization error', async ({ page }) => {
	const errors: Error[] = [];
	page.on('pageerror', (err) => {
		errors.push(err);
	});
	await page.goto('/schedule/chat?date=2026-06-20');
	await expect(page).toHaveTitle(/./);
	expect(errors).toEqual([]);
});

