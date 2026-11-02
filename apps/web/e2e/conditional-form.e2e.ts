import { expect, test } from './support/test.ts';
import { readAppointment } from './support/database.ts';
import { pickFirstBookableDay, pickSlotFromEndOfDay } from './support/wizard.ts';
import { signInAsAdmin } from './support/auth.ts';

test('conditional questions are required only while visible and hidden answers are not saved', async ({
	page
}) => {
	await page.goto('/schedule/conditional-form');
	await pickFirstBookableDay(page);
	await pickSlotFromEndOfDay(page);
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();

	await page.getByLabel('Your name').fill('Phone Guest');
	await page.getByLabel('Phone number').fill('+1 202 555 0123');
	await page.getByLabel('Meeting place').selectOption('Garden trail');
	const focus = page.getByLabel('Meeting focus');
	const details = page.getByLabel('Project details');
	const submit = page.getByRole('button', { name: 'Request', exact: true });
	await focus.selectOption('General question');
	await expect(details).toBeHidden();
	await expect(submit).toBeEnabled();

	await focus.selectOption('Project review');
	await expect(details).toBeVisible();
	await expect(details).toHaveValue('');
	await expect(submit).toBeDisabled();
	await details.fill('This answer must not survive hiding the question.');
	await expect(submit).toBeEnabled();

	await focus.selectOption('General question');
	await expect(details).toBeHidden();
	await expect(submit).toBeEnabled();
	await submit.click();
	await page.waitForURL(/\/appointment\/[^/?]+\?token=.+/);
	await expect(page.getByRole('heading', { name: 'Appointment requested' })).toBeVisible();

	const id = new URL(page.url()).pathname.split('/').at(-1)!;
	const row = await readAppointment(id);
	expect(row).toMatchObject({
		event_type_id: 'conditional-form',
		guest_name: 'Phone Guest',
		guest_email: null,
		location: 'Garden trail',
		status: 'pending'
	});
	// This form legitimately collects a phone number instead of an email address.
	expect(JSON.parse(row.guest_answers!)).toEqual([
		{ name: 'phone', label: 'Phone number', type: 'phone', value: '+1 202 555 0123' },
		{ name: 'focus', label: 'Meeting focus', type: 'choice', value: 'General question' }
	]);

	const reschedule = `/appointment/${id}/reschedule?token=${encodeURIComponent(row.cancel_token)}`;
	for (const role of ['guest', 'host']) {
		if (role === 'host') await signInAsAdmin(page);
		await page.goto(reschedule);
		await page.getByRole('button', { name: 'Continue', exact: true }).click();
		await page.getByRole('button', { name: 'Confirm', exact: true }).click();
		const location = page.getByLabel('Meeting place');
		await expect(location).toHaveValue('Garden trail');
		await expect(page.getByLabel('Meeting focus')).toHaveValue('General question');
		if (role === 'guest') await expect(location).toBeEnabled();
		else await expect(location).toBeDisabled();
	}
	expect(await readAppointment(id)).toEqual(row);
});
