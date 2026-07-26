import { expect, test } from '@playwright/test';
import { CHAT_MEETING } from './support/seed.ts';
import { pickFirstBookableDay, pickSlotFromEndOfDay } from './support/wizard.ts';

test('a guest books a meeting from the home page', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('link', { name: CHAT_MEETING.name }).click();

	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
	await pickFirstBookableDay(page);

	await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
	// A booked slot is gone for good, so each attempt must aim one slot further back.
	await pickSlotFromEndOfDay(page, test.info().retry + test.info().repeatEachIndex);
	await page.getByRole('button', { name: 'Confirm' }).click();

	await expect(page.getByRole('heading', { name: 'Step 3 of 3: Enter your info' })).toBeVisible();
	await page.getByLabel('What is your name?').fill('E2E Guest');
	await page.getByLabel('What is your email?').fill('e2e-guest@example.test');
	await page.getByRole('button', { name: 'Request' }).click();

	await page.waitForURL(/\/appointment\/[^/?]+\?token=.+/);
	await expect(page.getByRole('heading', { name: 'Appointment requested' })).toBeVisible();
	await expect(page.getByRole('heading', { name: CHAT_MEETING.name })).toBeVisible();
});
