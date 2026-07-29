import { expect, test } from '@playwright/test';
import { parseActionLog } from '@when/db';
import { readAppointment } from './support/database.ts';
import { signInAsAdmin } from './support/auth.ts';
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

test('rotating the guest link kills the old one and issues a working replacement', async ({
	page,
	request
}) => {
	const appointment = await seedAppointment({ status: 'confirmed' });
	const oldLink = `/appointment/${appointment.id}?token=${appointment.cancel_token}`;

	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);
	await page.getByRole('button', { name: 'Appointment actions' }).click();
	await page.getByRole('menuitem', { name: 'Guest Link' }).click();

	const link = page.locator('input.share-input');
	await expect(link).toHaveValue(new RegExp(appointment.cancel_token));

	await page.getByRole('button', { name: 'Rotate link' }).click();

	// The dialog stays open and swaps in the new link, ready to copy.
	await expect(link).not.toHaveValue(new RegExp(appointment.cancel_token));

	const rotated = await readAppointment(appointment.id);
	await expect(link).toHaveValue(new RegExp(rotated.cancel_token));

	// Selected, so the token at the tail is scrolled into view and ready to copy.
	await expect(link).toBeFocused();
	expect(await link.evaluate((el: HTMLInputElement) => el.selectionEnd === el.value.length)).toBe(
		true
	);
	expect(rotated.cancel_token).not.toBe(appointment.cancel_token);
	expect(parseActionLog(rotated.action_log).at(-1)).toMatchObject({
		action: 'rotate',
		actor: 'host'
	});

	const stale = await request.get(oldLink);
	expect(stale.status()).toBe(404);

	const fresh = await request.get(`/appointment/${appointment.id}?token=${rotated.cancel_token}`);
	expect(fresh.status()).toBe(200);
});

test('a signed-out visitor cannot rotate a guest link', async ({ request }) => {
	const appointment = await seedAppointment({ status: 'confirmed' });

	const response = await request.post(`/admin/appointment/${appointment.id}?/rotate`, {
		headers: { origin: 'http://localhost:4183' },
		form: {}
	});

	expect(response.status()).toBe(403);
	expect((await readAppointment(appointment.id)).cancel_token).toBe(appointment.cancel_token);
});
