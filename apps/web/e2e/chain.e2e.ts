import { expect, test } from '@playwright/test';
import { readAppointment } from './support/database.ts';
import { seedAppointment } from './support/seed.ts';
import { pickLastBookableDay, pickSlotFromEndOfDay } from './support/wizard.ts';

// Characterizes the guest-facing chain links. The stale-link assertions below are the
// surface the forward-isolation work changes.
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

	const successor = await readAppointment(successorId);
	expect(await latest.getAttribute('href')).toBe(
		`/appointment/${successorId}?token=${encodeURIComponent(successor.cancel_token)}`
	);
});

test('the cancel form refuses a token from a different appointment', async ({ page, request }) => {
	const mine = await seedAppointment({ status: 'confirmed' });
	const theirs = await seedAppointment({ status: 'confirmed' });

	await page.goto(`/appointment/${mine.id}?token=${mine.cancel_token}`);

	const response = await request.post(`/appointment/${mine.id}?/cancel`, {
		headers: { origin: new URL(page.url()).origin },
		form: { token: theirs.cancel_token, reason: 'let me in' }
	});

	// Kit serializes an action failure into a 200 envelope; the rejection is inside it.
	expect(await response.json()).toMatchObject({ type: 'failure', status: 403 });
	expect((await readAppointment(mine.id)).status).toBe('confirmed');
});
