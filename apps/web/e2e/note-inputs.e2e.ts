import { expect, test } from './support/test.ts';
import { signInAsAdmin } from './support/auth.ts';
import { readAppointment } from './support/database.ts';
import { seedAppointment } from './support/seed.ts';
import { futureWeekday } from './support/dates.ts';

test('general notes and existing bulk cancellation use the same counter without changing requiredness', async ({
	page
}) => {
	const day = futureWeekday();
	const appointment = await seedAppointment({
		status: 'confirmed',
		start: new Date(`${day}T23:00:00Z`)
	});
	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);
	await page.getByRole('button', { name: 'Appointment actions', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Add Note', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Add Note', exact: true });
	const note = dialog.getByLabel('Note (optional)', { exact: true });
	await expect(note).not.toHaveAttribute('required');
	await expect(note).toHaveAttribute('maxlength', '1000');
	await expect(dialog.getByText('0/1000', { exact: true })).toBeVisible();
	await note.fill('A note');
	await expect(dialog.getByText('6/1000', { exact: true })).toBeVisible();
	await note.clear();
	await expect(dialog.getByText('0/1000', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();

	await page.goto('/admin/appointments/upcoming');
	const row = page.locator('.appointment-row').filter({
		has: page.getByRole('link', { name: appointment.guest_name, exact: true })
	});
	await row.getByRole('checkbox', { name: 'Select appointment', exact: true }).check();
	await page.getByRole('button', { name: 'Cancel 1', exact: true }).click();
	const cancellation = page.getByRole('dialog', { name: 'Cancel 1 Appointment?', exact: true });
	const reason = cancellation.getByLabel('Reason for cancelling', { exact: true });
	await expect(reason).toHaveAttribute('required', '');
	await expect(reason).toHaveAttribute('maxlength', '500');
	const initial = await reason.inputValue();
	await expect(cancellation.getByText(`${initial.length}/500`, { exact: true })).toBeVisible();
	await reason.fill('Testing');
	await expect(cancellation.getByText('7/500', { exact: true })).toBeVisible();
	await cancellation.getByRole('button', { name: 'Cancel', exact: true }).click();
	const unchanged = await readAppointment(appointment.id);
	expect(unchanged).toEqual(appointment);
});

test('rescheduling still requires a reason and shows the shared 500-character counter', async ({
	page
}) => {
	const day = futureWeekday();
	const appointment = await seedAppointment({
		status: 'pending',
		start: new Date(`${day}T14:00:00Z`)
	});
	const slot = encodeURIComponent(`${day}T15:00:00Z`);
	await page.goto(
		`/appointment/${appointment.id}/reschedule?token=${appointment.cancel_token}&slot=${slot}`
	);
	await expect(page.getByRole('heading', { name: 'Step 3 of 3: Enter your info' })).toBeVisible();
	const reason = page.getByLabel('Reason for rescheduling');
	await expect(reason).toHaveAttribute('required', '');
	await expect(reason).toHaveAttribute('maxlength', '500');
	await expect(page.getByText('0/500', { exact: true })).toBeVisible();
	await reason.fill('A reason');
	await expect(page.getByText('8/500', { exact: true })).toBeVisible();
	const unchanged = await readAppointment(appointment.id);
	expect(unchanged).toEqual(appointment);
});
