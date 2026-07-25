import { expect, test } from '@playwright/test';
import { CHAT_MEETING, seedAppointment } from './support/seed.ts';

test('a guest with the cancel token sees the appointment', async ({ page }) => {
	const appointment = await seedAppointment({ status: 'pending' });

	await page.goto(`/appointment/${appointment.id}?token=${appointment.cancel_token}`);

	await expect(page.getByRole('heading', { name: 'Pending', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: CHAT_MEETING.name })).toBeVisible();
});

test('a guest without a token cannot see the appointment', async ({ page }) => {
	const appointment = await seedAppointment({ status: 'pending' });

	const response = await page.goto(`/appointment/${appointment.id}`);

	expect(response?.status()).toBe(404);
});

test('a guest with the wrong token cannot see the appointment', async ({ page }) => {
	const appointment = await seedAppointment({ status: 'pending' });

	const response = await page.goto(`/appointment/${appointment.id}?token=not-the-token`);

	expect(response?.status()).toBe(404);
});
