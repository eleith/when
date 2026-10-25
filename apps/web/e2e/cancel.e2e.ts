import { expect, test } from '@playwright/test';
import { parseActionLog } from '@when/db';
import { readAppointment, readQueuedWorkflows } from './support/database.ts';
import { CHAT_MEETING, seedAppointment } from './support/seed.ts';

test('a guest with the cancel token sees the appointment', async ({ page }) => {
	const appointment = await seedAppointment({ status: 'pending' });

	await page.goto(`/appointment/${appointment.id}?token=${appointment.cancel_token}`);

	await expect(page.getByRole('heading', { name: 'Pending', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: CHAT_MEETING.title })).toBeVisible();
});

test('a guest cancels a confirmed appointment', async ({ page }) => {
	const appointment = await seedAppointment({ status: 'confirmed' });

	await page.goto(`/appointment/${appointment.id}?token=${appointment.cancel_token}`);
	await page.getByRole('button', { name: 'Appointment actions' }).click();
	await page.getByRole('menuitem', { name: 'Cancel' }).click();
	const dialog = page.getByRole('dialog', { name: 'Cancel appointment', exact: true });
	const reason = dialog.getByLabel('Reason (required)', { exact: true });
	await expect(reason).toHaveAttribute('required', '');
	await expect(reason).toHaveAttribute('maxlength', '500');
	const initialReason = await reason.inputValue();
	await expect(dialog.getByText(`${initialReason.length}/500`, { exact: true })).toBeVisible();
	await reason.fill('Something came up');
	await expect(dialog.getByText('17/500', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

	await expect(page.getByRole('heading', { name: 'Cancelled', exact: true })).toBeVisible();

	// The action explanation is stored in history, not the general appointment note.
	const row = await readAppointment(appointment.id);
	expect(row.status).toBe('cancelled');
	expect(parseActionLog(row.action_log).at(-1)).toMatchObject({
		action: 'cancel',
		actor: 'guest',
		payload: { note: 'Something came up' }
	});
	expect(
		readQueuedWorkflows(`${appointment.id}:cancelled-by-guest:${row.ics_sequence}`)
	).toHaveLength(1);
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
