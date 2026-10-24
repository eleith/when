import { expect, test, type Page } from '@playwright/test';
import { signInAsAdmin } from './support/auth.ts';
import { readAppointment } from './support/database.ts';
import { seedAppointment } from './support/seed.ts';

function futureWeekday(offset: number, weekdayIndex = 0): string {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() + offset);
	for (let index = 0; index <= weekdayIndex; index++) {
		if (index > 0) date.setUTCDate(date.getUTCDate() + 1);
		while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
			date.setUTCDate(date.getUTCDate() + 1);
		}
	}
	return date.toISOString().slice(0, 10);
}

async function changeNextSubmittedField(page: Page, name: string, value: string) {
	// Reach server validation while keeping the visible, client-valid input unchanged.
	await page.locator('#appointment-form').evaluate(
		(element, change) => {
			if (!(element instanceof HTMLFormElement)) throw new Error('Expected appointment form');
			element.addEventListener(
				'formdata',
				(event) => {
					event.formData.set(change.name, change.value);
				},
				{ once: true }
			);
		},
		{ name, value }
	);
}

test('host creation shows server field errors and preserves inputs for a successful retry', async ({
	page
}, testInfo) => {
	const day = futureWeekday(5 + testInfo.retry * 7);
	await signInAsAdmin(page);
	await page.goto(`/schedule/chat?date=${day}`);
	await page.getByRole('radio', { name: /0?9:00\s*AM\s*–\s*0?9:30\s*AM/i }).click();
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	const name = 'Retained Validation Guest';
	const email = 'validation-feedback@example.test';
	await page.getByLabel('What is your name?').fill(name);
	await page.getByLabel('What is your email?').fill(email);
	const slot = await page.locator('input[name="slot"]').inputValue();
	const duration = await page.locator('input[name="duration"]').inputValue();
	await changeNextSubmittedField(page, 'name', '');
	const rejectionPromise = page.waitForResponse(
		(response) =>
			response.request().method() === 'POST' &&
			new URL(response.url()).pathname === '/admin/schedule/chat'
	);
	await page.getByRole('button', { name: 'Request', exact: true }).click();
	const rejection = await rejectionPromise;
	const result = await rejection.json();
	expect(result).toMatchObject({ type: 'failure', status: 400 });
	expect(result.data).toContain('Please enter your name.');
	await expect(page.getByRole('alert')).toHaveText('Please enter your name.');
	await expect(page.getByLabel('What is your name?')).toHaveValue(name);
	await expect(page.getByLabel('What is your name?')).toHaveAttribute('aria-invalid', 'true');
	await expect(page.getByLabel('What is your email?')).toHaveValue(email);
	await expect(page.locator('input[name="slot"]')).toHaveValue(slot);
	await expect(page.locator('input[name="duration"]')).toHaveValue(duration);
	await expect(page.getByRole('heading', { name: 'Step 3 of 3: Enter your info' })).toBeVisible();

	await page.getByRole('button', { name: 'Request', exact: true }).click();
	await page.waitForURL(/\/appointment\/[^/?]+$/);
	const id = new URL(page.url()).pathname.split('/').at(-1)!;
	const created = await readAppointment(id);
	expect(created).toMatchObject({ status: 'confirmed', guest_name: name, guest_email: email });
	expect(Date.parse(created.start_time)).toBe(Date.parse(slot));
	expect(Date.parse(created.end_time) - Date.parse(created.start_time)).toBe(
		Number(duration) * 60_000
	);
});

test('host rescheduling shows validation and conflict errors without losing the reason or duration', async ({
	page
}, testInfo) => {
	const day = futureWeekday(52, testInfo.retry);
	const original = await seedAppointment({
		status: 'confirmed',
		start: new Date(`${day}T14:00:00Z`),
		durationMinutes: 90
	});
	const actionPath = `/admin/appointment/${original.id}/reschedule`;
	await signInAsAdmin(page);
	await page.goto(
		`/appointment/${original.id}/reschedule?token=${original.cancel_token}&date=${day}`
	);
	await page.getByRole('radio', { name: /0?3:30\s*PM\s*–\s*0?5:00\s*PM/i }).click();
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	const reason = 'Keep this explanation while choosing another time';
	await page.getByLabel('Reason for rescheduling').fill(reason);
	const slot = await page.locator('input[name="slot"]').inputValue();
	await expect(page.locator('input[name="duration"]')).toHaveValue('90');
	await changeNextSubmittedField(page, 'reschedule_reason', '');
	const validationPromise = page.waitForResponse(
		(response) =>
			response.request().method() === 'POST' && new URL(response.url()).pathname === actionPath
	);
	await page.getByRole('button', { name: 'Confirm Reschedule', exact: true }).click();
	const validation = await validationPromise;
	const validationResult = await validation.json();
	expect(validationResult).toMatchObject({ type: 'failure', status: 400 });
	await expect(page.getByRole('alert')).toHaveText('Please provide a reason for rescheduling.');
	await expect(page.getByLabel('Reason for rescheduling')).toHaveValue(reason);
	await expect(page.locator('input[name="duration"]')).toHaveValue('90');
	await expect(page.locator('input[name="slot"]')).toHaveValue(slot);

	const blocker = await seedAppointment({ status: 'confirmed', start: new Date(slot) });
	const conflictPromise = page.waitForResponse(
		(response) =>
			response.request().method() === 'POST' && new URL(response.url()).pathname === actionPath
	);
	await page.getByRole('button', { name: 'Confirm Reschedule', exact: true }).click();
	const conflict = await conflictPromise;
	const conflictResult = await conflict.json();
	expect(conflictResult).toMatchObject({ type: 'failure', status: 409 });
	await expect(page.getByRole('alert')).toHaveText(
		'That time is no longer available. Please pick another.'
	);
	await expect(page.getByLabel('Reason for rescheduling')).toHaveValue(reason);
	await expect(page.getByLabel('What is your name?')).toHaveValue(original.guest_name);
	await expect(page.getByLabel('What is your email?')).toHaveValue(original.guest_email!);
	await expect(page.locator('input[name="duration"]')).toHaveValue('90');
	await expect(page.locator('input[name="slot"]')).toHaveValue(slot);
	const unchanged = await readAppointment(original.id);
	const unchangedBlocker = await readAppointment(blocker.id);
	expect(unchanged).toEqual(original);
	expect(unchangedBlocker).toEqual(blocker);

	await page.getByRole('button', { name: 'Back', exact: true }).click();
	// Keyboard activation avoids overlapping hit targets in the continuous timeline.
	await page.getByRole('radio', { name: /12:00\s*PM\s*–\s*0?1:30\s*PM/i }).press('Enter');
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await page.getByLabel('Reason for rescheduling').fill(reason);
	const replacementSlot = await page.locator('input[name="slot"]').inputValue();
	await page.getByRole('button', { name: 'Confirm Reschedule', exact: true }).click();
	await page.waitForURL(/\/appointment\/[^/?]+$/);
	const id = new URL(page.url()).pathname.split('/').at(-1)!;
	const moved = await readAppointment(id);
	const old = await readAppointment(original.id);
	expect(id).not.toBe(original.id);
	expect(old.status).toBe('rescheduled');
	expect(moved).toMatchObject({ status: 'confirmed', origin_id: original.id });
	expect(Date.parse(moved.start_time)).toBe(Date.parse(replacementSlot));
	expect(Date.parse(moved.end_time) - Date.parse(moved.start_time)).toBe(90 * 60_000);
});
