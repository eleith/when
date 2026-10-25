import { expect, test } from '@playwright/test';
import { appendActionLogSql, openDb, parseActionLog } from '@when/db';
import { signInAsAdmin } from './support/auth.ts';
import { APP_DB_PATH, readAppointment, readQueuedWorkflows } from './support/database.ts';
import { seedAppointment } from './support/seed.ts';

async function seedWithPrivateNote() {
	const appointment = await seedAppointment({ status: 'pending' });
	const db = openDb(APP_DB_PATH);
	try {
		await db
			.updateTable('appointments')
			.set({
				note: `Private appointment note ${appointment.id}`,
				action_log: appendActionLogSql({
					action: 'edit',
					actor: 'host',
					at: new Date().toISOString(),
					payload: { metadata: { changes: ['note_updated'] } }
				})
			})
			.where('id', '=', appointment.id)
			.execute();
	} finally {
		await db.destroy();
	}
	const seeded = await readAppointment(appointment.id);
	return seeded;
}

test('a decline note is stored separately and rendered as plain text to host and guest', async ({
	page,
	browser
}) => {
	const appointment = await seedWithPrivateNote();
	const note = 'Sorry, <b>not this time</b>.\n<script>window.declineNoteInjected = true</script>';
	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);
	const origin = new URL(page.url()).origin;
	const guest = await browser.newContext();
	try {
		const guestPage = await guest.newPage();
		const guestUrl = `${origin}/appointment/${appointment.id}?token=${appointment.cancel_token}`;
		await guestPage.goto(guestUrl);
		await expect(guestPage.getByRole('heading', { name: 'Pending', exact: true })).toBeVisible();
		await expect(guestPage.getByRole('button', { name: 'Decline', exact: true })).toHaveCount(0);
		const forbidden = await guest.request.post(
			`${origin}/admin/appointment/${appointment.id}?/decline&token=${appointment.cancel_token}&role=host`,
			{
				headers: { origin, accept: 'application/json', 'x-sveltekit-action': 'true' },
				form: {
					decline_note: note,
					token: appointment.cancel_token,
					role: 'host',
					isAdmin: 'true'
				},
				maxRedirects: 0
			}
		);
		expect(forbidden.status()).toBe(403);
		const afterForbidden = await readAppointment(appointment.id);
		expect(afterForbidden).toEqual(appointment);

		await page.getByRole('button', { name: 'Decline', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Decline appointment', exact: true });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText('0/500', { exact: true })).toBeVisible();
		await dialog.getByLabel('Note (optional)', { exact: true }).fill(note);
		await expect(dialog.getByText(`${note.length}/500`, { exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Decline', exact: true }).click();
		await expect(dialog).not.toBeVisible();
		await expect(page.getByRole('heading', { name: 'Declined', exact: true })).toBeVisible();
		const hostNote = page.locator('.state-note-line');
		await expect(hostNote).toBeVisible();
		await expect(hostNote.locator('.state-note-text')).toHaveCSS('white-space', 'pre-wrap');
		const hostText = await hostNote.textContent();
		expect(hostText).toContain(note);
		await expect(hostNote.locator('b, script')).toHaveCount(0);
		await expect(page.getByText(appointment.note!, { exact: true })).toBeVisible();

		const row = await readAppointment(appointment.id);
		expect(row.status).toBe('declined');
		expect(row.note).toBe(appointment.note);
		const log = parseActionLog(row.action_log);
		expect(log.slice(0, -1)).toEqual(parseActionLog(appointment.action_log));
		expect(log.filter((entry) => entry.action === 'decline')).toHaveLength(1);
		expect(log.at(-1)).toMatchObject({ action: 'decline', actor: 'host', payload: { note } });
		expect(log.at(-1)?.payload).toEqual({ note });
		expect(readQueuedWorkflows(`${appointment.id}:declined:${row.ics_sequence}`)).toEqual([
			{ workflow_name: 'reconcile-appointment' }
		]);

		const guestResponse = await guestPage.goto(guestUrl);
		expect(guestResponse?.status()).toBe(200);
		const guestHtml = await guestResponse!.text();
		expect(guestHtml).not.toContain(appointment.note!);
		expect(guestHtml).not.toContain('note_updated');
		await expect(guestPage.getByRole('heading', { name: 'Declined', exact: true })).toBeVisible();
		const guestNote = guestPage.locator('.state-note-line');
		await expect(guestNote).toBeVisible();
		await expect(guestNote.locator('.state-note-text')).toHaveCSS('white-space', 'pre-wrap');
		const guestText = await guestNote.textContent();
		expect(guestText).toContain(note);
		await expect(guestNote.locator('b, script')).toHaveCount(0);
		await expect(guestPage.getByText(appointment.note!, { exact: true })).toHaveCount(0);
		await expect(guestPage.getByText('Activity log', { exact: true })).toHaveCount(0);
	} finally {
		await guest.close();
	}
});

test('server rejection of 501 characters keeps the decline dialog and draft for a 500-character retry', async ({
	page
}) => {
	const appointment = await seedAppointment({ status: 'pending' });
	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);
	await page.getByRole('button', { name: 'Decline', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Decline appointment', exact: true });
	await expect(dialog).toBeVisible();
	const field = dialog.getByLabel('Note (optional)', { exact: true });
	await expect(field).not.toHaveAttribute('required');
	await expect(dialog.getByText('0/500', { exact: true })).toBeVisible();
	const draft = 'Please try another day.\nThank you for understanding.';
	await field.fill(draft);
	await expect(dialog.getByText(`${draft.length}/500`, { exact: true })).toBeVisible();
	await expect(field).toHaveAttribute('maxlength', '500');
	// Bypass only native maxlength, leaving the real enhanced action and visible draft intact.
	await dialog.locator('form').evaluate((element) => {
		if (!(element instanceof HTMLFormElement)) throw new Error('Expected decline form');
		element.addEventListener(
			'formdata',
			(event) => {
				event.formData.set('decline_note', 'x'.repeat(501));
			},
			{ once: true }
		);
	});
	const actionPath = `/admin/appointment/${appointment.id}`;
	const rejectionPromise = page.waitForResponse(
		(response) =>
			response.request().method() === 'POST' &&
			new URL(response.url()).pathname === actionPath &&
			new URL(response.url()).searchParams.has('/decline')
	);
	await dialog.getByRole('button', { name: 'Decline', exact: true }).click();
	const rejection = await rejectionPromise;
	const result = await rejection.json();
	expect(result).toMatchObject({ type: 'failure', status: 400 });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('alert')).toHaveText(
		'Decline note must be 500 characters or fewer.'
	);
	await expect(field).toHaveValue(draft);
	await expect(dialog.getByText(`${draft.length}/500`, { exact: true })).toBeVisible();
	await expect(field).toBeEnabled();
	await expect(page.getByRole('heading', { name: 'Pending', exact: true })).toBeVisible();
	const unchanged = await readAppointment(appointment.id);
	expect(unchanged).toEqual(appointment);
	expect(parseActionLog(unchanged.action_log).some((entry) => entry.action === 'decline')).toBe(
		false
	);
	expect(
		readQueuedWorkflows(`${appointment.id}:declined:${appointment.ics_sequence + 1}`)
	).toHaveLength(0);

	const corrected = 'x'.repeat(500);
	await field.fill(corrected);
	await expect(dialog.getByText('500/500', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Decline', exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByRole('heading', { name: 'Declined', exact: true })).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
	const saved = await readAppointment(appointment.id);
	expect(saved.status).toBe('declined');
	expect(saved.note).toBe(appointment.note);
	expect(parseActionLog(saved.action_log).at(-1)).toMatchObject({
		action: 'decline',
		actor: 'host',
		payload: { note: corrected }
	});
	expect(readQueuedWorkflows(`${appointment.id}:declined:${saved.ics_sequence}`)).toHaveLength(1);
});

test('accepting in another host tab makes the stale decline fail without writing its note', async ({
	page
}) => {
	const appointment = await seedWithPrivateNote();
	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);
	await page.getByRole('button', { name: 'Decline', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Decline appointment', exact: true });
	await expect(dialog).toBeVisible();
	const draft = 'Do not save this stale decline.\nThe request has already been accepted.';
	const field = dialog.getByLabel('Note (optional)', { exact: true });
	await expect(dialog.getByText('0/500', { exact: true })).toBeVisible();
	await field.fill(draft);
	await expect(dialog.getByText(`${draft.length}/500`, { exact: true })).toBeVisible();

	const otherHost = await page.context().newPage();
	try {
		await otherHost.goto(page.url());
		await otherHost.getByRole('button', { name: 'Accept', exact: true }).click();
		await expect(otherHost.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
	} finally {
		await otherHost.close();
	}
	const confirmed = await readAppointment(appointment.id);
	expect(confirmed.status).toBe('confirmed');
	expect(confirmed.note).toBe(appointment.note);
	const actionPath = `/admin/appointment/${appointment.id}`;
	const conflictPromise = page.waitForResponse(
		(response) =>
			response.request().method() === 'POST' &&
			new URL(response.url()).pathname === actionPath &&
			new URL(response.url()).searchParams.has('/decline')
	);
	await dialog.getByRole('button', { name: 'Decline', exact: true }).click();
	const conflict = await conflictPromise;
	const result = await conflict.json();
	expect(result).toMatchObject({ type: 'failure', status: 409 });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('alert')).toHaveText('This appointment can no longer be declined.');
	await expect(field).toHaveValue(draft);
	await expect(dialog.getByText(`${draft.length}/500`, { exact: true })).toBeVisible();
	await expect(field).toBeEnabled();
	const unchanged = await readAppointment(appointment.id);
	expect(unchanged).toEqual(confirmed);
	expect(parseActionLog(unchanged.action_log).some((entry) => entry.action === 'decline')).toBe(
		false
	);
	expect(readQueuedWorkflows(`${appointment.id}:confirmed:${confirmed.ics_sequence}`)).toHaveLength(
		1
	);
	expect(readQueuedWorkflows(`${appointment.id}:declined:${confirmed.ics_sequence}`)).toHaveLength(
		0
	);
	expect(
		readQueuedWorkflows(`${appointment.id}:declined:${confirmed.ics_sequence + 1}`)
	).toHaveLength(0);
});
