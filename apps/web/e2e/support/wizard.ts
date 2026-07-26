import { expect, type Page } from '@playwright/test';
import { CHAT_MEETING } from './seed.ts';

// The server marks every day the guest cannot book; whatever is left is bookable.
function bookableDays(page: Page) {
	return page.locator('.cal-day:not([data-unavailable]):not([data-disabled])');
}

export async function pickFirstBookableDay(page: Page): Promise<void> {
	await bookableDays(page).first().click();
	await page.getByRole('button', { name: 'Continue' }).click();
}

export async function pickLastBookableDay(page: Page): Promise<void> {
	await bookableDays(page).last().click();
	await page.getByRole('button', { name: 'Continue' }).click();
}

// Hour labels sit one hour apart down the timeline, which is the only rendered
// scale the page offers for turning a duration into pixels.
async function pixelsPerHour(page: Page): Promise<number> {
	const labels = page.locator('.timeline-label');
	const first = await labels.nth(0).boundingBox();
	const second = await labels.nth(1).boundingBox();
	if (!first || !second) throw new Error('the timeline rendered fewer than two hour labels');
	return second.y - first.y;
}

/**
 * Select the slot `slotsFromEnd` back from the close of the day's last working
 * window.
 *
 * The timeline has no element per slot in `insert` booking style — the track is a
 * bare div that snaps a pointer position to the nearest slot — so a position is the
 * only way in. It has to be the tail: the first bookable day is today whenever today
 * still has a free slot, and everything before now is greyed out and swallows clicks.
 * Since a day is only offered when a slot remains, and remaining slots are always the
 * latest ones, the end of the window is the one region bookable at any hour.
 */
export async function pickSlotFromEndOfDay(page: Page, slotsFromEnd = 0): Promise<void> {
	const workingWindow = page.locator('.working-window').last();
	const box = await workingWindow.boundingBox();
	if (!box) throw new Error('the day rendered no working window');

	const slotHeight = (await pixelsPerHour(page)) * (CHAT_MEETING.durationMinutes / 60);
	const centreOfTargetSlot = box.height - slotHeight * (slotsFromEnd + 0.5);

	await workingWindow.click({ position: { x: box.width / 2, y: centreOfTargetSlot } });

	// Fail here rather than at whatever the caller does next: a click that lands on a
	// past or busy band is silently ignored by the timeline.
	await expect(page.locator('.slot-block.selected')).toBeVisible();
}
