import { expect, test } from '@playwright/test';

async function pickASlot(page: import('@playwright/test').Page): Promise<string> {
	await page.goto('/schedule/chat');
	await page.locator('.cal-day:not([data-unavailable]):not([data-disabled])').first().click();
	await page.getByRole('button', { name: 'Continue' }).click();
	const workingWindow = page.locator('.working-window').first();
	const box = await workingWindow.boundingBox();
	// Late in the window, clear of the times booking.e2e.ts consumes.
	await workingWindow.click({
		position: { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) * 0.8 }
	});
	await page.getByRole('button', { name: 'Confirm' }).click();
	return page.locator('input[name="slot"]').inputValue();
}

test('a slot link opens the form with that time held', async ({ page }) => {
	const slot = await pickASlot(page);

	await page.goto(`/schedule/chat?slot=${encodeURIComponent(slot)}`);

	await expect(page.getByRole('heading', { name: 'Step 3 of 3: Enter your info' })).toBeVisible();
	await expect(page.locator('input[name="slot"]')).toHaveValue(slot);
});

test('unknown parameters are dropped from the url', async ({ page }) => {
	await page.goto('/schedule/chat?bogus=1');

	await expect(page).toHaveURL('/schedule/chat');
});

test('a duration that is not offered is dropped from the url', async ({ page }) => {
	await page.goto('/schedule/chat?duration=999');

	await expect(page).toHaveURL('/schedule/chat');
});

test('a day link with no availability explains itself without breaking the router', async ({
	page
}) => {
	const errors: Error[] = [];
	page.on('pageerror', (error) => errors.push(error));

	await page.goto('/schedule/chat?date=2026-06-20');

	await expect(page.getByText('has no availability')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
	expect(errors).toEqual([]);
});
