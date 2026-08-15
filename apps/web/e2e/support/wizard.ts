import { expect, type Page } from '@playwright/test';

// The server marks every day the guest cannot book; whatever is left is bookable.
function bookableDays(page: Page) {
	return page.locator('.cal-day:not([data-unavailable]):not([data-disabled])');
}

/**
 * Page forward to the first month offering a bookable day.
 *
 * The calendar renders one month, so "the first bookable day" is not necessarily in the
 * month that opens: run this after the fixture's last working window closes on a Friday
 * and every remaining day of the month is in the past. Without this the suite passes
 * during office hours and fails every evening and weekend.
 */
async function monthWithBookableDays(page: Page, monthsToTry = 3): Promise<void> {
	for (let attempt = 0; attempt < monthsToTry; attempt++) {
		if ((await bookableDays(page).count()) > 0) return;

		const month = page.getByRole('heading', { level: 2 });
		const shown = await month.textContent();
		await page.getByRole('button', { name: 'Next' }).click();
		await expect(month).not.toHaveText(shown ?? '');
	}

	if ((await bookableDays(page).count()) === 0) {
		throw new Error(`no bookable day within ${monthsToTry} months of the opening month`);
	}
}

export async function pickFirstBookableDay(page: Page): Promise<void> {
	await monthWithBookableDays(page);
	await bookableDays(page).first().click();
	await page.getByRole('button', { name: 'Continue' }).click();
}

export async function pickLastBookableDay(page: Page): Promise<void> {
	await monthWithBookableDays(page);
	await bookableDays(page).last().click();
	await page.getByRole('button', { name: 'Continue' }).click();
}

/**
 * Select the slot `slotsFromEnd` back from the end of the available bookable slots.
 *
 * Available slots are rendered as accessible radio buttons in the timeline track.
 */
export async function pickSlotFromEndOfDay(page: Page, slotsFromEnd = 0): Promise<void> {
	const slots = page.getByRole('radio');
	const count = await slots.count();
	if (count === 0) throw new Error('the day rendered no bookable slots');

	const targetIndex = Math.max(0, count - 1 - slotsFromEnd);
	await slots.nth(targetIndex).click();

	await expect(page.locator('.slot-block.selected')).toBeVisible();
}
