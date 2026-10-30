import { expect, test } from './support/test.ts';
import { pickLastBookableDay, pickSlotFromEndOfDay } from './support/wizard.ts';

async function pickASlot(page: import('@playwright/test').Page): Promise<string> {
	await page.goto('/schedule/chat');
	await pickLastBookableDay(page);
	await pickSlotFromEndOfDay(page);
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
	await expect(page).toHaveURL('/schedule/chat');
	await pickLastBookableDay(page);
	await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
	expect(errors).toEqual([]);
});
