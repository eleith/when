import { expect, test, type Page } from './support/test.ts';
import { parseActionLog } from '@when/db';
import { signInAsAdmin } from './support/auth.ts';
import { readAppointment, readQueuedWorkflows } from './support/database.ts';
import { seedAppointment } from './support/seed.ts';
import { futureWeekday } from './support/dates.ts';

const postOptions = (origin: string) => ({
	headers: { origin, accept: 'application/json' },
	maxRedirects: 0
});
const savedWarning =
	'The duration was saved, but calendar and email update submission could not be confirmed.';

function durationAction(id: string): string {
	return `/admin/appointment/${id}?/changeDuration`;
}

async function openDurationEditor(page: Page) {
	await page.getByRole('button', { name: 'Appointment actions', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Change duration', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Change duration', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

test('host extends in place outside working hours, touching a neighbor despite buffers and cap', async ({
	baseURL,
	page,
	request
}, testInfo) => {
	const day = futureWeekday();
	const original = await seedAppointment({
		eventTypeId: 'host-rules',
		status: 'confirmed',
		start: new Date(`${day}T18:00:00Z`)
	});
	const neighbor = await seedAppointment({
		eventTypeId: 'host-rules',
		status: 'confirmed',
		start: new Date(`${day}T19:30:00Z`)
	});
	const actionPath = durationAction(original.id);
	await page.goto(`/appointment/${original.id}?token=${original.cancel_token}`);
	await page.getByRole('button', { name: 'Appointment actions', exact: true }).click();
	await expect(page.getByRole('menuitem', { name: 'Change duration', exact: true })).toHaveCount(0);
	await expect(page.getByRole('dialog', { name: 'Change duration', exact: true })).toHaveCount(0);
	await page.keyboard.press('Escape');
	const forbidden = await request.post(actionPath, {
		...postOptions(baseURL!),
		form: { duration: '90', token: original.cancel_token, role: 'host', isAdmin: 'true' }
	});
	expect(forbidden.status()).toBe(403);
	const beforeEdit = await readAppointment(original.id);
	expect(beforeEdit).toEqual(original);

	await signInAsAdmin(page);
	await page.goto(`/appointment/${original.id}`);
	await page.emulateMedia({ colorScheme: 'light' });
	const dialog = await openDurationEditor(page);
	await expect(dialog.getByLabel('Duration', { exact: true })).toHaveValue('30');
	await dialog.getByLabel('Duration', { exact: true }).selectOption('90');
	const desktopScreenshot = await page.screenshot({
		path: testInfo.outputPath('duration-editor-desktop-light.png')
	});
	await testInfo.attach('duration-editor-desktop-light', {
		body: desktopScreenshot,
		contentType: 'image/png'
	});
	const responsePromise = page.waitForResponse(
		(response) => response.request().method() === 'POST' && response.url().endsWith(actionPath)
	);
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	const response = await responsePromise;
	const result = await response.json();
	expect(result).toMatchObject({ type: 'success', status: 200 });
	expect(result.data).toContain('duration_changed');
	await expect(dialog.getByRole('status')).toHaveText('Duration saved.');
	await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
	await expect(dialog.getByLabel('Duration', { exact: true })).toBeDisabled();
	await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);

	const saved = await readAppointment(original.id);
	expect(saved).toMatchObject({
		id: original.id,
		start_time: original.start_time,
		status: original.status,
		cancel_token: original.cancel_token,
		origin_id: original.origin_id,
		video_chat: original.video_chat,
		video_chat_request: original.video_chat_request,
		calendar_revision: original.calendar_revision + 1,
		ics_sequence: original.ics_sequence + 1
	});
	expect(Date.parse(saved.end_time) - Date.parse(saved.start_time)).toBe(90 * 60_000);
	expect(Date.parse(saved.end_time)).toBe(Date.parse(neighbor.start_time));
	const log = parseActionLog(saved.action_log);
	expect(log).toHaveLength(parseActionLog(original.action_log).length + 1);
	expect(log.at(-1)).toMatchObject({
		action: 'edit',
		actor: 'host',
		payload: {
			metadata: { changes: ['duration_updated'], previous_duration: 30, duration: 90 }
		}
	});
	expect(readQueuedWorkflows(`${original.id}:edited-by-host:${saved.ics_sequence}`)).toEqual([
		{ workflow_name: 'reconcile-appointment' }
	]);
	const unchangedNeighbor = await readAppointment(neighbor.id);
	expect(unchangedNeighbor).toEqual(neighbor);
	await dialog.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.locator('.detail-primary').filter({ hasText: /6:00.*7:30/ })).toBeVisible();
	await page.getByText('Activity log', { exact: true }).click();
	await expect(
		page.getByText('Duration changed from 30 to 90 minutes', { exact: true })
	).toBeVisible();
});

test('actual overlap stays inline and the same dialog can shorten to configured 25, not invented 75', async ({
	baseURL,
	page
}) => {
	const day = futureWeekday();
	const original = await seedAppointment({
		eventTypeId: 'host-durations',
		status: 'confirmed',
		start: new Date(`${day}T18:00:00Z`),
		durationMinutes: 60
	});
	const neighbor = await seedAppointment({
		eventTypeId: 'host-durations',
		status: 'confirmed',
		start: new Date(`${day}T19:15:00Z`)
	});
	const actionPath = durationAction(original.id);
	await signInAsAdmin(page);
	const unsupported = await page.request.post(actionPath, {
		...postOptions(baseURL!),
		form: {
			duration: '75',
			currentDuration: '75',
			id: neighbor.id,
			start_time: `${day}T09:00:00Z`
		}
	});
	const unsupportedResult = await unsupported.json();
	expect(unsupportedResult).toMatchObject({ type: 'failure', status: 400 });
	expect(unsupportedResult.data).toContain('Please pick a valid meeting length.');
	await page.goto(`/appointment/${original.id}`);
	const dialog = await openDurationEditor(page);
	await expect(dialog.getByRole('option', { name: '25 minutes', exact: true })).toHaveCount(1);
	await expect(dialog.getByRole('option', { name: '75 minutes', exact: true })).toHaveCount(0);
	await dialog.getByLabel('Duration', { exact: true }).selectOption('90');
	const rejectedPromise = page.waitForResponse(
		(response) => response.request().method() === 'POST' && response.url().endsWith(actionPath)
	);
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	const rejected = await rejectedPromise;
	const rejectedResult = await rejected.json();
	expect(rejectedResult).toMatchObject({ type: 'failure', status: 409 });
	await expect(dialog.getByRole('alert')).toHaveText(
		'That length overlaps another appointment or busy event.'
	);
	await expect(dialog.getByLabel('Duration', { exact: true })).toHaveValue('90');
	await expect(dialog.getByLabel('Duration', { exact: true })).toBeEnabled();
	await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
	await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
	const unchanged = await readAppointment(original.id);
	expect(unchanged).toEqual(original);

	await dialog.getByLabel('Duration', { exact: true }).selectOption('25');
	const savedPromise = page.waitForResponse(
		(response) => response.request().method() === 'POST' && response.url().endsWith(actionPath)
	);
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	const savedResponse = await savedPromise;
	const savedResult = await savedResponse.json();
	expect(savedResult).toMatchObject({ type: 'success', status: 200 });
	expect(savedResult.data).toContain('duration_changed');
	// The browser sends an absolute duration only; identity/start are read by the server.
	const submittedBody = savedResponse.request().postData();
	expect(submittedBody).toContain('name="duration"');
	expect(submittedBody).not.toMatch(/name="(?:id|start|start_time|slot)"/);
	await expect(dialog.getByRole('status')).toHaveText('Duration saved.');
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
	const saved = await readAppointment(original.id);
	expect(saved.start_time).toBe(original.start_time);
	expect(Date.parse(saved.end_time) - Date.parse(original.start_time)).toBe(25 * 60_000);
	const unchangedNeighbor = await readAppointment(neighbor.id);
	expect(unchangedNeighbor).toEqual(neighbor);

	const noOp = await page.request.post(actionPath, {
		...postOptions(baseURL!),
		form: { duration: '25', id: neighbor.id, start_time: `${day}T09:00:00Z` }
	});
	const noOpResult = await noOp.json();
	expect(noOpResult).toMatchObject({ type: 'success', status: 200 });
	expect(noOpResult.data).toContain('no_change');
	const afterNoOp = await readAppointment(original.id);
	expect(afterNoOp).toEqual(saved);
	await dialog.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.locator('.detail-primary').filter({ hasText: /6:00.*6:25/ })).toBeVisible();
});

test('in-progress edits require a future end; ended pending appointments have no editor', async ({
	baseURL,
	page
}) => {
	// Only this case uses a live interval: 15 ends five minutes ago, 30 ten minutes ahead.
	const start = new Date(Date.now() - 20 * 60_000);
	const original = await seedAppointment({
		eventTypeId: 'host-rules',
		status: 'confirmed',
		start,
		durationMinutes: 60
	});
	const actionPath = durationAction(original.id);
	await signInAsAdmin(page);
	await page.goto(`/appointment/${original.id}`);
	await expect(page.getByRole('heading', { name: 'In progress', exact: true })).toBeVisible();
	const dialog = await openDurationEditor(page);
	await dialog.getByLabel('Duration', { exact: true }).selectOption('15');
	const rejectedPromise = page.waitForResponse(
		(response) => response.request().method() === 'POST' && response.url().endsWith(actionPath)
	);
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	const rejected = await rejectedPromise;
	const rejectedResult = await rejected.json();
	expect(rejectedResult).toMatchObject({ type: 'failure', status: 400 });
	await expect(dialog.getByRole('alert')).toHaveText('Choose a length that ends in the future.');
	const unchanged = await readAppointment(original.id);
	expect(unchanged).toEqual(original);
	await dialog.getByLabel('Duration', { exact: true }).selectOption('30');
	const savedPromise = page.waitForResponse(
		(response) => response.request().method() === 'POST' && response.url().endsWith(actionPath)
	);
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	const savedResponse = await savedPromise;
	const savedResult = await savedResponse.json();
	expect(savedResult).toMatchObject({ type: 'success', status: 200 });
	expect(savedResult.data).toContain('duration_changed');
	await expect(dialog.getByRole('status')).toHaveText('Duration saved.');
	await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
	const saved = await readAppointment(original.id);
	expect(saved.start_time).toBe(original.start_time);
	expect(Date.parse(saved.end_time) - start.getTime()).toBe(30 * 60_000);
	expect(saved.status).toBe('confirmed');
	await dialog.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByRole('heading', { name: 'In progress', exact: true })).toBeVisible();

	const endedPending = await seedAppointment({
		eventTypeId: 'host-rules',
		status: 'pending',
		start: new Date(start.getTime() - 2 * 60 * 60_000)
	});
	await page.goto(`/appointment/${endedPending.id}`);
	await expect(page.getByRole('heading', { name: 'Pending', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Appointment actions', exact: true }).click();
	await expect(page.getByRole('menuitem', { name: 'Change duration', exact: true })).toHaveCount(0);
	await expect(page.getByRole('dialog', { name: 'Change duration', exact: true })).toHaveCount(0);
	const gated = await page.request.post(durationAction(endedPending.id), {
		...postOptions(baseURL!),
		form: { duration: '90' }
	});
	const gatedResult = await gated.json();
	expect(gatedResult).toMatchObject({ type: 'failure', status: 400 });
	expect(gatedResult.data).toContain('This appointment cannot be edited.');
	const unchangedPending = await readAppointment(endedPending.id);
	expect(unchangedPending).toEqual(endedPending);
});

test('a saved-warning receipt waits for explicit reload and cannot blindly resubmit', async ({
	page
}, testInfo) => {
	const day = futureWeekday();
	const original = await seedAppointment({
		eventTypeId: 'host-rules',
		status: 'confirmed',
		start: new Date(`${day}T18:00:00Z`)
	});
	const actionPath = durationAction(original.id);
	await signInAsAdmin(page);
	await page.setViewportSize({ width: 320, height: 720 });
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto(`/appointment/${original.id}`);
	let submissions = 0;
	const refreshRequests: string[] = [];
	page.on('request', (request) => {
		const path = new URL(request.url()).pathname;
		if (
			request.method() === 'GET' &&
			(path === `/appointment/${original.id}` || path === `/appointment/${original.id}/__data.json`)
		) {
			refreshRequests.push(request.url());
		}
	});
	await page.route(`**${actionPath}`, async (route) => {
		submissions++;
		const realResponse = await route.fetch();
		const realResult = await realResponse.json();
		expect(realResult).toMatchObject({ type: 'success', status: 200 });
		expect(realResult.data).toContain('duration_changed');
		// Public SvelteKit ActionResult wire format: data is a devalue flat table.
		// This simulates a saved-warning RECEIPT after a real commit, not a queue failure.
		await route.fulfill({
			status: 500,
			contentType: 'application/json',
			body: JSON.stringify({
				type: 'failure',
				status: 500,
				data: JSON.stringify([{ error: 1, durationSaved: 2 }, savedWarning, true])
			})
		});
	});
	const dialog = await openDurationEditor(page);
	await dialog.getByLabel('Duration', { exact: true }).selectOption('90');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog.getByRole('alert')).toHaveText(savedWarning);
	await expect(dialog.getByLabel('Duration', { exact: true })).toBeDisabled();
	await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);
	await expect(
		dialog.getByRole('button', { name: 'Reload appointment', exact: true })
	).toBeEnabled();
	const saved = await readAppointment(original.id);
	expect(Date.parse(saved.end_time) - Date.parse(original.start_time)).toBe(90 * 60_000);
	expect(saved.ics_sequence).toBe(original.ics_sequence + 1);
	const mobileScreenshot = await page.screenshot({
		path: testInfo.outputPath('duration-editor-saved-warning-mobile-320-dark.png')
	});
	await testInfo.attach('duration-editor-saved-warning-mobile-320-dark', {
		body: mobileScreenshot,
		contentType: 'image/png'
	});
	await page.keyboard.press('Escape');
	await expect(dialog.getByRole('alert')).toHaveText(savedWarning);
	expect(refreshRequests).toEqual([]);
	const reload = page.waitForNavigation({ waitUntil: 'load' });
	await dialog.getByRole('button', { name: 'Reload appointment', exact: true }).click();
	await reload;
	await expect(dialog).not.toBeVisible();
	await expect(page.locator('.detail-primary').filter({ hasText: /6:00.*7:30/ })).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(refreshRequests).toHaveLength(1);
	const reopened = await openDurationEditor(page);
	await expect(reopened.getByLabel('Duration', { exact: true })).toHaveValue('90');
	await expect(reopened.getByRole('alert')).toHaveCount(0);
	expect(submissions).toBe(1);
});

test('an aborted action reports uncertainty, not rollback, and never automatically repeats', async ({
	page
}) => {
	const day = futureWeekday();
	const original = await seedAppointment({
		eventTypeId: 'host-rules',
		status: 'confirmed',
		start: new Date(`${day}T18:00:00Z`)
	});
	const actionPath = durationAction(original.id);
	await signInAsAdmin(page);
	await page.goto(`/appointment/${original.id}`);
	let submissions = 0;
	await page.route(`**${actionPath}`, async (route) => {
		submissions++;
		// Controlled transport loss before forwarding; a real lost response need not roll back.
		await route.abort('failed');
	});
	const dialog = await openDurationEditor(page);
	await dialog.getByLabel('Duration', { exact: true }).selectOption('90');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog.getByRole('alert')).toHaveText(
		'Could not confirm whether the duration was saved. Reload the page to check before making another change.'
	);
	await expect(dialog).not.toContainText(/save failed|rolled back|not saved/i);
	await expect(dialog.getByRole('status')).toHaveCount(0);
	await expect(dialog.getByLabel('Duration', { exact: true })).toBeDisabled();
	await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Reload to check', exact: true })).toBeEnabled();
	const unchanged = await readAppointment(original.id);
	expect(unchanged).toEqual(original);
	await page.keyboard.press('Escape');
	await expect(dialog.getByRole('alert')).toContainText('Could not confirm whether');
	await dialog.getByRole('button', { name: 'Reload to check', exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.locator('.detail-primary').filter({ hasText: /6:00.*6:30/ })).toBeVisible();
	expect(submissions).toBe(1);
});

test('known saved survives unavailable refresh until the user explicitly acknowledges it', async ({
	page
}) => {
	const day = futureWeekday();
	const original = await seedAppointment({
		eventTypeId: 'host-rules',
		status: 'confirmed',
		start: new Date(`${day}T18:00:00Z`)
	});
	const actionPath = durationAction(original.id);
	const detailPath = `/appointment/${original.id}`;
	await signInAsAdmin(page);
	await page.goto(detailPath);
	let submissions = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().endsWith(actionPath)) submissions++;
	});
	const refreshRequests: string[] = [];
	// Public HTTP failures only: an automatic data request would abort and could destroy
	// the receipt. An explicitly acknowledged document reload gets a bounded error page.
	await page.route(
		(url) => url.pathname === detailPath || url.pathname === `${detailPath}/__data.json`,
		async (route) => {
			const request = route.request();
			refreshRequests.push(request.url());
			if (request.isNavigationRequest()) {
				await route.fulfill({
					status: 503,
					contentType: 'text/html',
					body: '<!doctype html><title>Reload unavailable</title><h1>Appointment reload unavailable</h1>'
				});
			} else {
				await route.abort('failed');
			}
		}
	);
	const dialog = await openDurationEditor(page);
	await dialog.getByLabel('Duration', { exact: true }).selectOption('90');
	const responsePromise = page.waitForResponse(
		(response) => response.request().method() === 'POST' && response.url().endsWith(actionPath)
	);
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	const response = await responsePromise;
	const result = await response.json();
	expect(result).toMatchObject({ type: 'success', status: 200 });
	expect(result.data).toContain('duration_changed');
	await expect(dialog.getByRole('status')).toHaveText('Duration saved.');
	const saved = await readAppointment(original.id);
	expect(Date.parse(saved.end_time) - Date.parse(original.start_time)).toBe(90 * 60_000);
	expect(saved.calendar_revision).toBe(original.calendar_revision + 1);
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await expect(dialog).not.toContainText(/could not confirm whether|save failed|not saved/i);
	await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
	await page.keyboard.press('Escape');
	await expect(dialog.getByRole('status')).toHaveText('Duration saved.');
	expect(refreshRequests).toEqual([]);
	expect(submissions).toBe(1);

	await dialog.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Appointment reload unavailable' })).toBeVisible();
	await expect(dialog).not.toBeVisible();
	expect(refreshRequests).toHaveLength(1);
	await expect(page.locator('body')).not.toContainText(/save failed|not saved|rolled back/i);
	const afterAcknowledgement = await readAppointment(original.id);
	expect(afterAcknowledgement).toEqual(saved);
	expect(submissions).toBe(1);
});
