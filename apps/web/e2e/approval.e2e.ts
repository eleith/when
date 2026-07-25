import { expect, test } from '@playwright/test';
import { signInAsAdmin } from './support/auth.ts';
import { seedAppointment } from './support/seed.ts';

test('the host accepts a request and the guest sees it confirmed', async ({ page, browser }) => {
	const appointment = await seedAppointment({ status: 'pending' });

	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);
	await page.getByRole('button', { name: 'Accept' }).click();

	await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();

	const origin = new URL(page.url()).origin;
	const guest = await browser.newContext();
	const guestPage = await guest.newPage();
	await guestPage.goto(`${origin}/appointment/${appointment.id}?token=${appointment.cancel_token}`);

	await expect(guestPage.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
	await guest.close();
});

test('the host declines a request', async ({ page }) => {
	const appointment = await seedAppointment({ status: 'pending' });

	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);
	await page.getByRole('button', { name: 'Decline' }).click();

	await expect(page.getByRole('heading', { name: 'Declined', exact: true })).toBeVisible();
});
