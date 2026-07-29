import { expect, test } from '@playwright/test';
import { readAppointment } from './support/database.ts';
import { seedAppointment } from './support/seed.ts';
import { pickLastBookableDay, pickSlotFromEndOfDay } from './support/wizard.ts';

test('a stale link shows the rescheduled state and links to the live appointment', async ({
	page
}) => {
	const original = await seedAppointment({ status: 'confirmed' });
	const staleLink = `/appointment/${original.id}?token=${original.cancel_token}`;

	await page.goto(`/appointment/${original.id}/reschedule?token=${original.cancel_token}`);
	await pickLastBookableDay(page);
	await pickSlotFromEndOfDay(page, 3 + test.info().retry);
	await page.getByRole('button', { name: 'Confirm' }).click();
	await page.locator('textarea[name="reschedule_reason"]').fill('Something came up');
	await page
		.getByRole('button', { name: /Reschedule|Request|Confirm/ })
		.last()
		.click();

	await page.waitForURL(/\/appointment\/[^/?]+\?token=.+/);
	const successorId = new URL(page.url()).pathname.split('/').at(-1)!;
	expect(successorId).not.toBe(original.id);

	await page.goto(staleLink);

	await expect(page.getByRole('heading', { name: 'Rescheduled', exact: true })).toBeVisible();
	const latest = page.getByRole('link', { name: 'View latest appointment' });
	await expect(latest).toBeVisible();

	expect(await latest.getAttribute('href')).toBe(
		`/appointment/${successorId}?token=${encodeURIComponent(original.cancel_token)}`
	);
	const followed = await page.goto(`/appointment/${successorId}?token=${original.cancel_token}`);
	expect(followed?.status()).toBe(404);
});

test('the live token is a master key over the appointment history', async ({ page }) => {
	const original = await seedAppointment({ status: 'confirmed' });

	await page.goto(`/appointment/${original.id}/reschedule?token=${original.cancel_token}`);
	await pickLastBookableDay(page);
	await pickSlotFromEndOfDay(page, 6 + test.info().retry);
	await page.getByRole('button', { name: 'Confirm' }).click();
	await page.locator('textarea[name="reschedule_reason"]').fill('Moving again');
	await page
		.getByRole('button', { name: /Reschedule|Request|Confirm/ })
		.last()
		.click();
	await page.waitForURL(/\/appointment\/[^/?]+\?token=.+/);

	const successorId = new URL(page.url()).pathname.split('/').at(-1)!;
	const successor = await readAppointment(successorId);

	const response = await page.goto(`/appointment/${original.id}?token=${successor.cancel_token}`);

	expect(response?.status()).toBe(200);
	await expect(page.getByRole('heading', { name: 'Rescheduled', exact: true })).toBeVisible();
});

test('the cancel form refuses a token from a different appointment', async ({ page, request }) => {
	const mine = await seedAppointment({ status: 'confirmed' });
	const theirs = await seedAppointment({ status: 'confirmed' });

	await page.goto(`/appointment/${mine.id}?token=${mine.cancel_token}`);

	const response = await request.post(`/appointment/${mine.id}?/cancel`, {
		headers: { origin: new URL(page.url()).origin },
		form: { token: theirs.cancel_token, reason: 'let me in' }
	});

	expect(await response.json()).toMatchObject({ type: 'failure', status: 403 });
	expect((await readAppointment(mine.id)).status).toBe('confirmed');
});
