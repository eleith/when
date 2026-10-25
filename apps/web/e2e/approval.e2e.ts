import { expect, test } from '@playwright/test';
import { parseActionLog } from '@when/db';
import { signInAsAdmin } from './support/auth.ts';
import { readAppointment, readQueuedWorkflows } from './support/database.ts';
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

	// Accepting is worth nothing if the guest is never told and the calendar never
	// learns, and the heading above is the same either way.
	const row = await readAppointment(appointment.id);
	expect(row.status).toBe('confirmed');
	expect(parseActionLog(row.action_log).at(-1)).toMatchObject({
		action: 'confirm',
		actor: 'host'
	});
	expect(readQueuedWorkflows(`${appointment.id}:confirmed:${row.ics_sequence}`)).toHaveLength(1);
});

test('the host declines a request', async ({ page }) => {
	const appointment = await seedAppointment({ status: 'pending' });

	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);
	await page.getByRole('button', { name: 'Decline', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Decline appointment', exact: true });
	await expect(dialog).toBeVisible();
	const note = dialog.getByLabel('Note (optional)', { exact: true });
	await expect(note).toHaveAttribute('name', 'decline_note');
	await expect(note).toHaveAttribute('maxlength', '500');
	await expect(note).not.toHaveAttribute('required');
	await expect(note).toHaveValue('');
	await expect(dialog.getByText('0/500', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Pending', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Decline', exact: true }).click();

	await expect(dialog).not.toBeVisible();
	await expect(page.getByRole('heading', { name: 'Declined', exact: true })).toBeVisible();

	const row = await readAppointment(appointment.id);
	expect(row.status).toBe('declined');
	const decline = parseActionLog(row.action_log).at(-1);
	expect(decline).toMatchObject({
		action: 'decline',
		actor: 'host'
	});
	expect(decline?.payload?.note).toBeUndefined();
	expect(readQueuedWorkflows(`${appointment.id}:declined:${row.ics_sequence}`)).toHaveLength(1);
});
