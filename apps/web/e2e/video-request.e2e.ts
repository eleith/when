import { expect, test, type Page } from './support/test.ts';
import { openDb } from '@when/db';
import { signInAsAdmin } from './support/auth.ts';
import { APP_DB_PATH, readAppointment } from './support/database.ts';
import { seedAppointment } from './support/seed.ts';

async function openActions(page: Page) {
	await page.getByRole('button', { name: 'Appointment actions' }).click();
}

test('Generate saves a standing request; reload keeps it until a saved link replaces it', async ({
	page
}) => {
	const appointment = await seedAppointment({ status: 'confirmed' });
	let submissions = 0;
	page.on('request', (request) => {
		if (
			request.method() === 'POST' &&
			request.url().endsWith(`/admin/appointment/${appointment.id}?/generateVideoChat`)
		) {
			submissions++;
		}
	});

	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);
	await openActions(page);
	await page.getByRole('menuitem', { name: 'Generate Video Link', exact: true }).click();

	const requested = page.getByRole('status').filter({ hasText: 'Video link requested' });
	await expect(requested).toContainText('You’ll be emailed when it is added.');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /refresh/i })).toHaveCount(0);
	const saved = await readAppointment(appointment.id);
	expect(saved.video_chat_request).toBe('generate');
	expect(saved.video_chat).toBeNull();
	expect(saved.ics_sequence).toBe(appointment.ics_sequence);
	expect(submissions).toBe(1);

	await page.reload();
	await expect(requested).toContainText('You’ll be emailed when it is added.');
	await openActions(page);
	await expect(
		page.getByRole('menuitem', { name: 'Cancel Video Link Request', exact: true })
	).toBeVisible();
	await expect(
		page.getByRole('menuitem', { name: 'Generate Video Link', exact: true })
	).toHaveCount(0);
	await page.keyboard.press('Escape');

	// There is no worker in this fixture. Simulate only its saved URI, not provider I/O.
	const url = 'https://video.example.test/call/ready';
	const db = openDb(APP_DB_PATH);
	try {
		await db
			.updateTable('appointments')
			.set({ video_chat: url })
			.where('id', '=', appointment.id)
			.execute();
	} finally {
		await db.destroy();
	}
	await page.reload();

	const linkRow = page.getByRole('button', { name: 'Edit video link', exact: true });
	await expect(linkRow.getByRole('link', { name: url, exact: true })).toHaveAttribute('href', url);
	await expect(requested).toHaveCount(0);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /refresh/i })).toHaveCount(0);
	await openActions(page);
	await expect(
		page.getByRole('menuitem', { name: 'Remove Video Link', exact: true })
	).toBeVisible();
	await expect(
		page.getByRole('menuitem', { name: 'Generate Video Link', exact: true })
	).toHaveCount(0);
	await expect(
		page.getByRole('menuitem', { name: 'Cancel Video Link Request', exact: true })
	).toHaveCount(0);
	expect(submissions).toBe(1);
});

test('Cancel Video Link Request suppresses generation without an ICS change or edit history', async ({
	page
}) => {
	const appointment = await seedAppointment({ status: 'confirmed' });
	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);
	await openActions(page);
	await page.getByRole('menuitem', { name: 'Generate Video Link', exact: true }).click();
	const requested = page.getByRole('status').filter({ hasText: 'Video link requested' });
	await expect(requested).toBeVisible();
	const beforeCancel = await readAppointment(appointment.id);

	await openActions(page);
	await page.getByRole('menuitem', { name: 'Cancel Video Link Request', exact: true }).click();

	await expect(requested).toHaveCount(0);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	const cancelled = await readAppointment(appointment.id);
	expect(cancelled.video_chat_request).toBe('suppress');
	expect(cancelled.video_chat).toBeNull();
	expect(cancelled.ics_sequence).toBe(beforeCancel.ics_sequence);
	expect(cancelled.action_log).toBe(beforeCancel.action_log);
	await openActions(page);
	await expect(
		page.getByRole('menuitem', { name: 'Generate Video Link', exact: true })
	).toBeEnabled();
	await expect(
		page.getByRole('menuitem', { name: 'Cancel Video Link Request', exact: true })
	).toHaveCount(0);
});

test('Remove Video Link directly clears the saved URI and advances ICS once', async ({ page }) => {
	const appointment = await seedAppointment({ status: 'confirmed' });
	const url = 'https://video.example.test/call/remove';
	const db = openDb(APP_DB_PATH);
	try {
		await db
			.updateTable('appointments')
			.set({ video_chat: url, video_chat_request: 'generate' })
			.where('id', '=', appointment.id)
			.execute();
	} finally {
		await db.destroy();
	}
	const beforeRemove = await readAppointment(appointment.id);
	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);
	await expect(page.getByRole('link', { name: url, exact: true })).toBeVisible();
	await openActions(page);
	await page.getByRole('menuitem', { name: 'Remove Video Link', exact: true }).click();

	await expect(page.getByRole('link', { name: url, exact: true })).toHaveCount(0);
	await expect(page.getByRole('status').filter({ hasText: 'Video link requested' })).toHaveCount(0);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	const removed = await readAppointment(appointment.id);
	expect(removed.video_chat).toBeNull();
	expect(removed.video_chat_request).toBe('suppress');
	expect(removed.ics_sequence).toBe(beforeRemove.ics_sequence + 1);
	await openActions(page);
	await expect(
		page.getByRole('menuitem', { name: 'Generate Video Link', exact: true })
	).toBeEnabled();
});

test('Generate is disabled only while submitting; an aborted save shows no false acknowledgement', async ({
	page
}) => {
	const appointment = await seedAppointment({ status: 'confirmed' });
	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);

	let releaseRequest!: () => void;
	const heldRequest = new Promise<void>((resolve) => {
		releaseRequest = resolve;
	});
	const actionUrl = `**/admin/appointment/${appointment.id}?/generateVideoChat`;
	await page.route(actionUrl, async (route) => {
		await heldRequest;
		await route.abort('failed');
	});
	const submissionStarted = page.waitForRequest(
		(request) =>
			request.method() === 'POST' && request.url().endsWith(`/${appointment.id}?/generateVideoChat`)
	);
	await openActions(page);
	await page.getByRole('menuitem', { name: 'Generate Video Link', exact: true }).click();
	const submission = await submissionStarted;
	expect(submission.method()).toBe('POST');
	try {
		await openActions(page);
		await expect(
			page.getByRole('menuitem', { name: 'Generate Video Link', exact: true })
		).toBeDisabled();
		await expect(page.getByRole('status').filter({ hasText: 'Video link requested' })).toHaveCount(
			0
		);
	} finally {
		releaseRequest();
	}

	await expect(page.getByRole('alert')).toContainText(/could not confirm|could not be confirmed/i);
	await expect(page.getByRole('status').filter({ hasText: 'Video link requested' })).toHaveCount(0);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(
		page.getByRole('menuitem', { name: 'Generate Video Link', exact: true })
	).toBeEnabled();
	const unchanged = await readAppointment(appointment.id);
	expect(unchanged).toEqual(appointment);
});

test('a failed Remove keeps the normal link, its menu action, and the stored row unchanged', async ({
	page
}) => {
	const appointment = await seedAppointment({ status: 'confirmed' });
	const url = 'https://video.example.test/call/keep';
	const db = openDb(APP_DB_PATH);
	try {
		await db
			.updateTable('appointments')
			.set({ video_chat: url, video_chat_request: 'generate' })
			.where('id', '=', appointment.id)
			.execute();
	} finally {
		await db.destroy();
	}
	const beforeRemove = await readAppointment(appointment.id);
	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);
	await page.route(`**/admin/appointment/${appointment.id}?/edit`, async (route) => {
		await route.abort('failed');
	});

	await openActions(page);
	await page.getByRole('menuitem', { name: 'Remove Video Link', exact: true }).click();

	await expect(page.getByRole('alert')).toContainText(/could not confirm|could not be confirmed/i);
	const linkRow = page.getByRole('button', { name: 'Edit video link', exact: true });
	await expect(linkRow.getByRole('link', { name: url, exact: true })).toHaveAttribute('href', url);
	await expect(page.getByRole('status').filter({ hasText: 'Video link requested' })).toHaveCount(0);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	const unchanged = await readAppointment(appointment.id);
	expect(unchanged).toEqual(beforeRemove);
	await openActions(page);
	await expect(
		page.getByRole('menuitem', { name: 'Remove Video Link', exact: true })
	).toBeEnabled();
	await expect(
		page.getByRole('menuitem', { name: 'Cancel Video Link Request', exact: true })
	).toHaveCount(0);
});

test('a real server rejection appears inline without acknowledging or changing the request', async ({
	page
}) => {
	const appointment = await seedAppointment({ status: 'confirmed' });
	await signInAsAdmin(page);
	await page.goto(`/appointment/${appointment.id}`);
	await page.route(`**/admin/appointment/${appointment.id}?/generateVideoChat`, async (route) => {
		const url = route.request().url().replace(appointment.id, `${appointment.id}-missing`);
		await route.continue({ url });
	});

	await openActions(page);
	await page.getByRole('menuitem', { name: 'Generate Video Link', exact: true }).click();

	await expect(page.getByRole('alert')).toContainText(/appointment not found/i);
	await expect(page.getByRole('status').filter({ hasText: 'Video link requested' })).toHaveCount(0);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	const unchanged = await readAppointment(appointment.id);
	expect(unchanged).toEqual(appointment);
	await openActions(page);
	await expect(
		page.getByRole('menuitem', { name: 'Generate Video Link', exact: true })
	).toBeEnabled();
});
