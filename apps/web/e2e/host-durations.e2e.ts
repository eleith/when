import { openDb, parseActionLog, replaceCalendarBusy } from '@when/db';
import { expect, test, type Page, type Request } from './support/test.ts';
import { signInAsAdmin } from './support/auth.ts';
import { APP_DB_PATH, readAppointment } from './support/database.ts';
import { seedAppointment } from './support/seed.ts';
import { futureWeekday } from './support/dates.ts';
import { pickFirstBookableDay } from './support/wizard.ts';

const slug = 'host-durations';
const hostDurations = [15, 25, 30, 45, 60, 90, 120, 180, 240, 300];
const postOptions = (origin: string) => ({
	headers: { origin, accept: 'application/json' },
	maxRedirects: 0
});
const forgedHost = { role: 'host', viewer: 'host', isAdmin: 'true' };

function durationTrigger(page: Page, current: number) {
	return page.getByRole('button', {
		name: `Change duration, currently ${current} minutes`,
		exact: true
	});
}

async function chooseDuration(page: Page, current: number, next: number): Promise<void> {
	await durationTrigger(page, current).click();
	const dialog = page.getByRole('dialog', { name: 'How long?' });
	await dialog.getByRole('button', { name: `${next} minutes`, exact: true }).click();
	await expect(dialog).not.toBeVisible();
}

test('a duration change clears an unavailable selected day and disables Continue', async ({
	page
}) => {
	const day = futureWeekday();
	const db = openDb(APP_DB_PATH);
	try {
		// The guest's 25-minute choice fits this day; 60 minutes only fits other days.
		await replaceCalendarBusy(db, 'main', [{ start: `${day}T09:30:00Z`, end: `${day}T12:00:00Z` }]);
	} finally {
		await db.destroy();
	}
	await page.goto(`/schedule/${slug}?duration=25&date=${day}`);
	await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(page.locator('.cal-day[data-selected]')).toHaveCount(1);
	await chooseDuration(page, 25, 60);
	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
	await expect(page.locator('.cal-day[data-selected]')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
	await expect.poll(() => new URL(page.url()).searchParams.get('date')).toBeNull();
});

test('host uses the configured default and finite palette, recovering locally from no availability', async ({
	baseURL,
	page,
	request
}) => {
	const day = futureWeekday();
	await signInAsAdmin(page);
	await page.goto(`/schedule/${slug}?date=${day}`);
	await expect(durationTrigger(page, 60)).toBeVisible();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Change timezone, currently/ })).toBeVisible();
	await durationTrigger(page, 60).click();
	const dialog = page.getByRole('dialog', { name: 'How long?' });
	await expect(dialog.locator('.duration-row')).toHaveText(
		hostDurations.map((duration) => `${duration} minutes`)
	);

	const durationRequests: string[] = [];
	const trackDurationRequest = (request: Request) => {
		if (request.isNavigationRequest() || ['fetch', 'xhr'].includes(request.resourceType())) {
			durationRequests.push(request.url());
		}
	};
	page.on('request', trackDurationRequest);
	await dialog.getByRole('button', { name: '300 minutes', exact: true }).click();
	await expect(
		page.getByText('No availability in the near future.', { exact: true })
	).toBeVisible();
	await expect(durationTrigger(page, 300)).toBeVisible();
	await expect(page.getByRole('button', { name: /^Change timezone, currently/ })).toBeVisible();
	await chooseDuration(page, 300, 90);
	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
	await expect(page.getByText('No availability in the near future.', { exact: true })).toHaveCount(
		0
	);
	await chooseDuration(page, 90, 300);
	await expect(
		page.getByText('No availability in the near future.', { exact: true })
	).toBeVisible();
	await chooseDuration(page, 300, 15);
	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
	await expect(durationTrigger(page, 15)).toBeVisible();
	await chooseDuration(page, 15, 90);
	// The earlier unavailable duration invalidated the calendar selection; pick a day again.
	await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
	await pickFirstBookableDay(page);
	await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
	const selectedDay = new URL(page.url()).searchParams.get('date');
	await expect(durationTrigger(page, 90)).toBeVisible();
	await chooseDuration(page, 90, 60);
	await chooseDuration(page, 60, 90);
	const target = page.getByRole('radio', { name: /10:30\s*AM\s*–\s*12:00\s*PM/i });
	await expect(target).toBeVisible();
	page.off('request', trackDurationRequest);
	expect(durationRequests).toEqual([]);

	await target.click();
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(page.getByRole('group', { name: 'Booking settings' })).toHaveCount(0);
	await expect(page.locator('.stage-subtitle')).toContainText(/90\s+min/);
	await expect(page.locator('#appointment-form')).toHaveAttribute(
		'action',
		`/admin/schedule/${slug}`
	);
	await expect(page.locator('input[name="duration"]')).toHaveValue('90');
	const slot = await page.locator('input[name="slot"]').inputValue();
	expect(Date.parse(slot)).toBe(Date.parse(`${selectedDay}T10:30:00Z`));
	const form = {
		slot,
		duration: '90',
		name: 'Host Duration Guest',
		email: 'duration@example.test'
	};
	for (const client of [request, page.request]) {
		// Neither a forged current length nor a real host cookie promotes the public action.
		const rejected = await client.post(`/schedule/${slug}`, {
			...postOptions(baseURL!),
			form: { ...form, ...forgedHost, currentDuration: '90' }
		});
		const result = await rejected.json();
		expect(result).toMatchObject({ type: 'failure', status: 400 });
	}
	await page.getByLabel('What is your name?').fill(form.name);
	await page.getByLabel('What is your email?').fill(form.email);
	await page.getByRole('button', { name: 'Request', exact: true }).click();
	await page.waitForURL(/\/appointment\/[^/?]+$/);

	const id = new URL(page.url()).pathname.split('/').at(-1)!;
	const created = await readAppointment(id);
	expect(created).toMatchObject({
		event_type_id: slug,
		status: 'confirmed',
		guest_name: form.name,
		guest_email: form.email
	});
	expect(Date.parse(created.start_time)).toBe(Date.parse(slot));
	expect(Date.parse(created.end_time) - Date.parse(created.start_time)).toBe(90 * 60_000);
});

test('rescheduling starts on the selected calendar at the trusted current 90, blocks only final no-op submission for both roles, and omission preserves it', async ({
	baseURL,
	page,
	request
}) => {
	const day = futureWeekday();
	const original = await seedAppointment({
		eventTypeId: slug,
		status: 'confirmed',
		start: new Date(`${day}T09:00:00Z`),
		durationMinutes: 90
	});
	const publicPath = `/appointment/${original.id}/reschedule`;
	const link = `${publicPath}?token=${original.cancel_token}&slot=${encodeURIComponent(original.start_time)}`;
	await page.goto(link);
	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
	await expect(page.locator('.cal-day[data-selected]')).toHaveAttribute('data-value', day);
	await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
	await expect(page.locator('#appointment-form')).toHaveCount(0);
	await expect(durationTrigger(page, 90)).toBeVisible();
	await durationTrigger(page, 90).click();
	const dialog = page.getByRole('dialog', { name: 'How long?' });
	await expect(dialog.locator('.duration-row')).toHaveText([
		'25 minutes',
		'60 minutes',
		'90 minutes'
	]);
	await expect(dialog.getByRole('button', { name: '120 minutes', exact: true })).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
	await expect(page.getByRole('radio', { name: /0?9:00\s*AM\s*–\s*10:30\s*AM/i })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Step 3 of 3: Enter your info' })).toBeVisible();
	await page.getByLabel('Reason for rescheduling').fill('No interval change');
	await expect(page.getByLabel('What is your name?')).toHaveValue(original.guest_name);
	await expect(page.getByLabel('What is your email?')).toHaveValue(original.guest_email!);
	await expect(
		page.getByRole('button', { name: 'Confirm Reschedule', exact: true })
	).toBeDisabled();
	const summary = page.getByRole('complementary', { name: 'Reschedule summary' });
	await expect(summary.getByText('Original', { exact: true })).toBeVisible();
	await expect(summary.locator('dd').nth(1)).toHaveText('—');
	await expect(summary.locator('dd').nth(0).getByRole('link')).toHaveCount(0);
	const returnLink = summary.getByRole('link', { name: 'Back to appointment', exact: true });
	await expect(returnLink).toHaveAttribute(
		'href',
		`/appointment/${original.id}?token=${encodeURIComponent(original.cancel_token)}`
	);
	const unchangedUrl = page.url();
	const actionPosts: string[] = [];
	const trackActionPost = (request: Request) => {
		if (request.method() === 'POST' && new URL(request.url()).pathname === publicPath) {
			actionPosts.push(request.url());
		}
	};
	page.on('request', trackActionPost);
	await page.getByLabel('What is your name?').press('Enter');
	// Bypass the disabled button to exercise enhance's own no-op cancellation.
	await page
		.locator('#appointment-form')
		.evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await expect(page).toHaveURL(unchangedUrl);
	expect(await readAppointment(original.id)).toEqual(original);
	page.off('request', trackActionPost);
	expect(actionPosts).toEqual([]);

	const form = {
		slot: `${day}T10:30:00Z`,
		token: original.cancel_token,
		name: original.guest_name,
		email: original.guest_email!,
		timezone: 'UTC',
		reschedule_reason: 'Keep the booked length at a new time'
	};
	await signInAsAdmin(page);
	await page.goto(link);
	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
	await expect(page.locator('.cal-day[data-selected]')).toHaveAttribute('data-value', day);
	await expect(durationTrigger(page, 90)).toBeVisible();
	await durationTrigger(page, 90).click();
	await expect(dialog.locator('.duration-row')).toHaveText(
		hostDurations.map((duration) => `${duration} minutes`)
	);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await page.getByLabel('Reason for rescheduling').fill('Still no interval change');
	await expect(
		page.getByRole('button', { name: 'Confirm Reschedule', exact: true })
	).toBeDisabled();
	const hostOnPublic = await page.request.post(publicPath, {
		...postOptions(baseURL!),
		form: { ...form, ...forgedHost, currentDuration: '120', duration: '120' }
	});
	const hostOnPublicResult = await hostOnPublic.json();
	expect(hostOnPublicResult).toMatchObject({ type: 'failure', status: 400 });
	const unchanged = await readAppointment(original.id);
	expect(unchanged).toEqual(original);

	// Omit duration entirely; even a forged currentDuration must not replace the row's length.
	const moved = await request.post(publicPath, {
		...postOptions(baseURL!),
		form: { ...form, ...forgedHost, currentDuration: '120' }
	});
	const redirect = await moved.json();
	expect(redirect).toMatchObject({ type: 'redirect', status: 303 });
	expect(redirect.location).toMatch(/^\/appointment\/[^/?]+\?token=.+/);
	const id = new URL(redirect.location, baseURL!).pathname.split('/').at(-1)!;
	expect(id).not.toBe(original.id);
	const old = await readAppointment(original.id);
	const next = await readAppointment(id);
	expect(old.status).toBe('rescheduled');
	expect(next).toMatchObject({
		event_type_id: slug,
		status: 'pending',
		origin_id: original.id,
		guest_name: original.guest_name,
		guest_email: original.guest_email,
		guest_timezone: 'UTC'
	});
	expect(Date.parse(next.start_time)).toBe(Date.parse(form.slot));
	expect(Date.parse(next.end_time) - Date.parse(next.start_time)).toBe(90 * 60_000);
	expect(next.cancel_token).not.toBe(original.cancel_token);
	expect(redirect.location).toBe(
		`/appointment/${id}?token=${encodeURIComponent(next.cancel_token)}`
	);
});

for (const { meeting, minutes, picker } of [
	{ meeting: slug, minutes: 25, picker: 'discrete slots' },
	{ meeting: 'chat', minutes: 30, picker: 'continuous timeline' }
]) {
	test(`guest can change only duration with ${picker}`, async ({ page }) => {
		const day = futureWeekday();
		const original = await seedAppointment({
			eventTypeId: meeting,
			status: 'confirmed',
			start: new Date(`${day}T09:00:00Z`),
			durationMinutes: 90
		});
		const publicPath = `/appointment/${original.id}/reschedule`;
		const reason = 'Use the shorter configured length';
		await page.goto(`${publicPath}?token=${original.cancel_token}`);
		await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
		await expect(page.locator('.cal-day[data-selected]')).toHaveAttribute('data-value', day);
		const summary = page.getByRole('complementary', { name: 'Reschedule summary' });
		await expect(summary.locator('dd').nth(1)).toHaveText('—');
		await chooseDuration(page, 90, minutes);
		await expect(summary.getByText('Proposed', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Continue', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
		const sameStart = page.getByRole('radio', {
			name: new RegExp(`0?9:00\\s*AM\\s*–\\s*0?9:${minutes}\\s*AM`, 'i')
		});
		await expect(sameStart).toHaveAttribute('aria-checked', 'true');
		await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
		await expect(summary.locator('dd').nth(1).locator('span').nth(1)).toHaveText(
			`9:00am – 9:${minutes}am`
		);

		await sameStart.focus();
		await sameStart.press('ArrowDown');
		await expect(sameStart).toHaveAttribute('aria-checked', 'false');
		await page.getByRole('radio', { checked: true }).press('ArrowUp');
		await expect(sameStart).toHaveAttribute('aria-checked', 'true');

		// Restoring the existing interval keeps selection and navigation; only final submission is gated.
		await chooseDuration(page, minutes, 90);
		await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
		await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName(
			/0?9:00\s*AM\s*–\s*10:30\s*AM/i
		);
		await expect(summary.locator('dd').nth(1)).toHaveText('—');
		await chooseDuration(page, 90, minutes);
		await expect(sameStart).toHaveAttribute('aria-checked', 'true');
		await page.getByRole('button', { name: 'Confirm', exact: true }).click();
		await expect(page.locator('#appointment-form')).toHaveAttribute('action', publicPath);
		await expect(page.locator('input[name="duration"]')).toHaveValue(String(minutes));
		await expect(page.getByLabel('What is your name?')).toHaveValue(original.guest_name);
		await expect(page.getByLabel('What is your name?')).toBeEnabled();
		await expect(page.getByLabel('What is your email?')).toHaveValue(original.guest_email!);
		await expect(page.getByLabel('What is your email?')).toBeEnabled();
		const slot = await page.locator('input[name="slot"]').inputValue();
		expect(Date.parse(slot)).toBe(Date.parse(original.start_time));
		await page.getByLabel('Reason for rescheduling').fill(reason);
		await expect(
			page.getByRole('button', { name: 'Confirm Reschedule', exact: true })
		).toBeEnabled();
		await page.getByLabel('What is your name?').press('Enter');
		await page.waitForURL(/\/appointment\/[^/?]+\?token=.+/);

		const id = new URL(page.url()).pathname.split('/').at(-1)!;
		expect(id).not.toBe(original.id);
		const old = await readAppointment(original.id);
		const next = await readAppointment(id);
		expect(old.status).toBe('rescheduled');
		expect(next).toMatchObject({
			event_type_id: meeting,
			status: 'pending',
			origin_id: original.id,
			guest_name: original.guest_name,
			guest_email: original.guest_email,
			ics_sequence: original.ics_sequence + 1
		});
		expect(Date.parse(next.start_time)).toBe(Date.parse(original.start_time));
		expect(Date.parse(next.end_time) - Date.parse(next.start_time)).toBe(minutes * 60_000);
		expect(parseActionLog(next.action_log)).toContainEqual(
			expect.objectContaining({ action: 'reschedule', actor: 'guest' })
		);
	});
}

test('host can reschedule only duration to a host-only length', async ({ page }) => {
	const day = futureWeekday();
	const original = await seedAppointment({
		eventTypeId: slug,
		status: 'confirmed',
		start: new Date(`${day}T09:00:00Z`),
		durationMinutes: 25
	});
	await signInAsAdmin(page);
	await page.goto(`/appointment/${original.id}/reschedule?token=${original.cancel_token}`);
	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
	await expect(page.locator('.cal-day[data-selected]')).toHaveAttribute('data-value', day);
	await chooseDuration(page, 25, 90);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
	await expect(page.getByRole('radio', { name: /0?9:00\s*AM\s*–\s*10:30\s*AM/i })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(page.locator('#appointment-form')).toHaveAttribute(
		'action',
		`/admin/appointment/${original.id}/reschedule`
	);
	await expect(page.getByLabel('What is your name?')).toBeDisabled();
	await page.getByLabel('Reason for rescheduling').fill('Extend this meeting');
	await page.getByRole('button', { name: 'Confirm Reschedule', exact: true }).click();
	await page.waitForURL(/\/appointment\/[^/?]+$/);

	const id = new URL(page.url()).pathname.split('/').at(-1)!;
	expect(id).not.toBe(original.id);
	expect((await readAppointment(original.id)).status).toBe('rescheduled');
	const next = await readAppointment(id);
	expect(next).toMatchObject({
		event_type_id: slug,
		status: 'confirmed',
		origin_id: original.id,
		guest_name: original.guest_name,
		guest_email: original.guest_email,
		ics_sequence: original.ics_sequence + 1
	});
	expect(Date.parse(next.start_time)).toBe(Date.parse(original.start_time));
	expect(Date.parse(next.end_time) - Date.parse(next.start_time)).toBe(90 * 60_000);
	expect(parseActionLog(next.action_log)).toContainEqual(
		expect.objectContaining({ action: 'reschedule', actor: 'host' })
	);
});

test('calendar Back navigation preserves duration, partial proposed facts, and explicit day or slot intent', async ({
	page
}) => {
	const day = futureWeekday();
	const original = await seedAppointment({
		eventTypeId: slug,
		status: 'confirmed',
		start: new Date(`${day}T09:00:00Z`),
		durationMinutes: 90
	});
	const link = `/appointment/${original.id}/reschedule?token=${original.cancel_token}`;
	const otherDate = new Date(`${day}T09:00:00Z`);
	do {
		otherDate.setUTCDate(otherDate.getUTCDate() + 1);
	} while (otherDate.getUTCDay() === 0 || otherDate.getUTCDay() === 6);
	const otherDay = otherDate.toISOString().slice(0, 10);
	const dayLabel = new Intl.DateTimeFormat('en-US', {
		timeZone: 'UTC',
		weekday: 'long',
		month: 'long',
		day: 'numeric'
	});
	const summary = page.getByRole('complementary', { name: 'Reschedule summary' });
	const proposed = summary.locator('dd').nth(1);
	const otherSummaryDate = new Intl.DateTimeFormat('en-US', {
		timeZone: 'UTC',
		weekday: 'short',
		month: 'short',
		day: 'numeric'
	}).format(otherDate);

	// Explicit day links open the time picker, without inventing a time selection.
	await page.goto(`${link}&date=${otherDay}`);
	await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
	await expect(page.locator('.stage-subtitle')).toHaveText(dayLabel.format(otherDate));
	await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
	await expect(summary.getByText('Proposed', { exact: true })).toBeVisible();
	await expect(proposed.locator('span').nth(0)).toHaveText(otherSummaryDate);
	await expect(proposed.locator('span').nth(1)).toHaveText('—');
	await expect(proposed).not.toContainText(/\bmin\b/);

	const unavailable = `${day}T11:30:00Z`;
	await page.goto(`${link}&slot=${encodeURIComponent(unavailable)}`);
	await expect(page.getByText(/is no longer available\. Pick another time/)).toBeVisible();
	await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
	await expect(proposed).toContainText('—');
	await expect(proposed).not.toContainText(/Choose|No changes yet/);
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Step 3 of 3: Enter your info' })).toBeVisible();
	await page.getByLabel('Reason for rescheduling').fill('A time is still missing');
	await expect(
		page.getByRole('button', { name: 'Confirm Reschedule', exact: true })
	).toBeDisabled();

	const alternative = `${day}T10:30:00Z`;
	await page.context().addCookies([{ name: 'tz', value: 'UTC', url: new URL(page.url()).origin }]);
	const response = await page.goto(`${link}&slot=${encodeURIComponent(alternative)}`);
	expect(response!.status()).toBe(200);
	const serverPage = await page.evaluate(
		(html) => {
			const document = new DOMParser().parseFromString(html, 'text/html');
			return {
				heading: document.querySelector('.stage-title')?.textContent?.trim(),
				action: document.querySelector('#appointment-form')?.getAttribute('action'),
				slot: document.querySelector('input[name="slot"]')?.getAttribute('value')
			};
		},
		await response!.text()
	);
	expect(serverPage).toEqual({
		heading: 'Step 3 of 3: Enter your info',
		action: `/appointment/${original.id}/reschedule`,
		slot: alternative
	});
	await expect(page.getByRole('heading', { name: 'Step 3 of 3: Enter your info' })).toBeVisible();
	expect(Date.parse(await page.locator('input[name="slot"]').inputValue())).toBe(
		Date.parse(alternative)
	);
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	const selectedTime = page.getByRole('radio', { checked: true });
	await selectedTime.press('ArrowUp');
	await selectedTime.press('ArrowUp');
	await expect(selectedTime).toHaveAccessibleName(/0?9:30\s*AM\s*–\s*11:00\s*AM/i);
	// Changing display zones must not replay the incoming 10:30 slot over this new draft.
	for (const { zone, time, range } of [
		{ zone: 'Kiritimati', time: /11:30\s*PM\s*–\s*0?1:00\s*AM/i, range: '11:30pm – 1:00am' },
		{ zone: 'Abidjan', time: /0?9:30\s*AM\s*–\s*11:00\s*AM/i, range: '9:30am – 11:00am' }
	]) {
		await page.getByRole('button', { name: /^Change timezone, currently/ }).click();
		const timezone = page.getByRole('dialog', { name: 'Choose timezone' });
		await timezone.getByRole('searchbox').fill(zone);
		await timezone.getByRole('button', { name: new RegExp(`^${zone}\\b`) }).click();
		await expect(timezone).not.toBeVisible();
		await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
		await expect(selectedTime).toHaveAccessibleName(time);
		await expect(proposed.locator('span').nth(1)).toHaveText(range);
	}
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	expect(Date.parse(await page.locator('input[name="slot"]').inputValue())).toBe(
		Date.parse(`${day}T09:30:00Z`)
	);

	// Without query intent, start on the real calendar with the booked day selected.
	await page.goto(link);
	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
	await expect(page.locator('.cal-day[data-selected]')).toHaveAttribute('data-value', day);
	await expect(summary.locator('dd').nth(1)).toHaveText('—');
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('radio', { checked: true })).toHaveAccessibleName(
		/0?9:00\s*AM\s*–\s*10:30\s*AM/i
	);
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await chooseDuration(page, 90, 25);
	await page.locator(`.cal-day[data-value="${otherDay}"]`).click();
	await expect(page.locator('.cal-day[data-selected]')).toHaveAttribute('data-value', otherDay);
	await expect(summary.getByText('Proposed', { exact: true })).toBeVisible();
	await expect(proposed.locator('span').nth(0)).toHaveText(otherSummaryDate);
	await expect(proposed.locator('span').nth(1)).toHaveText('—');
	await expect(proposed).not.toContainText(/\bmin\b/);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.locator('.stage-subtitle')).toHaveText(dayLabel.format(otherDate));
	await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();

	await page.getByRole('button', { name: 'Back', exact: true }).click();
	// Deselecting a day exposes both missing facts, not proposed action copy.
	await page.locator('.cal-day[data-selected]').click();
	await expect(page.locator('.cal-day[data-selected]')).toHaveCount(0);
	await expect(proposed.locator('span')).toHaveText(['—', '—']);
	await expect(proposed).not.toContainText(/Choose|No changes yet/);
	await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
	const originalDay = page.locator(`.cal-day[data-value="${day}"]`);
	// Returning from a next-month day can put the original just outside the visible grid.
	if ((await originalDay.count()) === 0) await page.locator('.cal-nav-btn').first().click();
	await originalDay.click();
	await expect(page.locator('.cal-day[data-selected]')).toHaveAttribute('data-value', day);
	await expect(durationTrigger(page, 25)).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.locator('.stage-subtitle')).toHaveText(
		dayLabel.format(new Date(original.start_time))
	);
	await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
	await page.getByRole('radio', { name: /0?9:30\s*AM\s*–\s*0?9:55\s*AM/i }).click();
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Step 3 of 3: Enter your info' })).toBeVisible();
	await expect(summary.locator('dd').nth(0).locator('span').nth(1)).toHaveText('9:00am – 10:30am');
	await expect(proposed.locator('span').nth(1)).toHaveText('9:30am – 9:55am');
	await expect(page.locator('input[name="duration"]')).toHaveValue('25');
	expect(Date.parse(await page.locator('input[name="slot"]').inputValue())).toBe(
		Date.parse(`${day}T09:30:00Z`)
	);
});

test('an unavailable original interval starts on its selected UTC+14 calendar day, permits navigation, and requires a fitting change to submit', async ({
	baseURL,
	page
}) => {
	const day = futureWeekday();
	const original = await seedAppointment({
		eventTypeId: slug,
		status: 'confirmed',
		start: new Date(`${day}T11:30:00Z`),
		durationMinutes: 90
	});
	const timezone = 'Pacific/Kiritimati';
	await page
		.context()
		.addCookies([{ name: 'tz', value: encodeURIComponent(timezone), url: baseURL! }]);
	const link = `/appointment/${original.id}/reschedule?token=${original.cancel_token}`;
	const localDay = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(
		new Date(original.start_time)
	);
	const localDate = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		weekday: 'long',
		month: 'long',
		day: 'numeric'
	}).format(new Date(original.start_time));
	const localSummaryDate = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		weekday: 'short',
		month: 'short',
		day: 'numeric'
	}).format(new Date(original.start_time));
	// The .000 original-slot link is calendar context, even though 90 minutes overruns noon.
	await page.goto(`${link}&slot=${encodeURIComponent(original.start_time)}`);
	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
	await expect(page.locator('.cal-day[data-selected]')).toHaveAttribute('data-value', localDay);
	await expect(page.getByText(/is no longer available\. Pick another time/)).toHaveCount(0);

	await page.goto(link);
	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
	await expect(page.locator('.cal-day[data-selected]')).toHaveAttribute('data-value', localDay);
	await expect(durationTrigger(page, 90)).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
	await expect(page.locator('.stage-subtitle')).toHaveText(localDate);
	await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
	await expect(page.getByRole('status')).toHaveText(
		"The current start time isn't available for this duration. Choose another time or duration."
	);
	const summary = page.getByRole('complementary', { name: 'Reschedule summary' });
	await expect(summary.locator('dd').nth(0)).toContainText(localSummaryDate);
	await expect(summary.locator('dd').nth(0).locator('span').nth(1)).toHaveText('1:30am – 3:00am');
	await expect(summary.locator('dd').nth(1)).toHaveText('—');
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await page.getByLabel('Reason for rescheduling').fill('This interval is not offered');
	await expect(
		page.getByRole('button', { name: 'Confirm Reschedule', exact: true })
	).toBeDisabled();
	await page.getByRole('button', { name: 'Back', exact: true }).click();

	await chooseDuration(page, 90, 25);
	await expect(page.locator('.stage-subtitle')).toHaveText(localDate);
	await expect(page.getByRole('radio', { name: /0?1:30\s*AM\s*–\s*0?1:55\s*AM/i })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
	await expect(page.locator('.reschedule-notice')).toHaveCount(0);
	await expect(summary.locator('dd').nth(1)).toContainText(localSummaryDate);
	await expect(summary.locator('dd').nth(1).locator('span').nth(1)).toHaveText('1:30am – 1:55am');

	await chooseDuration(page, 25, 60);
	await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
	await expect(page.getByRole('status')).toHaveText(
		'Choose an available start time for this duration.'
	);
	await expect(summary.locator('dd').nth(1)).toContainText('—');
	await expect(summary.locator('dd').nth(1).locator('span').nth(1)).toHaveText('—');
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Step 3 of 3: Enter your info' })).toBeVisible();
	await page.getByLabel('Reason for rescheduling').fill('No compatible start has been chosen');
	await expect(
		page.getByRole('button', { name: 'Confirm Reschedule', exact: true })
	).toBeDisabled();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await chooseDuration(page, 60, 25);
	await page.getByRole('radio', { name: /0?1:30\s*AM\s*–\s*0?1:55\s*AM/i }).click();
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	expect(Date.parse(await page.locator('input[name="slot"]').inputValue())).toBe(
		Date.parse(original.start_time)
	);
	await expect(page.locator('input[name="duration"]')).toHaveValue('25');
	await page.getByLabel('Reason for rescheduling').fill('Use the fitting shorter length');
	await expect(page.getByRole('button', { name: 'Confirm Reschedule', exact: true })).toBeEnabled();
});

test.describe('rescheduling before the browser timezone is initialized', () => {
	test.use({ timezoneId: 'America/Los_Angeles' });

	test('a no-cookie explicit day waits for the viewer timezone, while a no-query reload selects the original local calendar day', async ({
		page
	}) => {
		const day = futureWeekday();
		const original = await seedAppointment({
			eventTypeId: slug,
			status: 'confirmed',
			start: new Date(`${day}T00:30:00Z`),
			durationMinutes: 60
		});
		const link = `/appointment/${original.id}/reschedule?token=${original.cancel_token}`;
		expect((await page.context().cookies()).filter(({ name }) => name === 'tz')).toEqual([]);
		const response = await page.goto(`${link}&date=${day}`);
		expect(await response!.text()).not.toContain('You selected');
		await expect(
			page.getByRole('button', { name: /^Change timezone, currently Los Angeles/ })
		).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
		await expect(page.getByRole('radio').first()).toBeVisible();
		const dateLabel = (date: Date) =>
			new Intl.DateTimeFormat('en-US', {
				timeZone: 'America/Los_Angeles',
				weekday: 'long',
				month: 'long',
				day: 'numeric'
			}).format(date);
		await expect(page.locator('.stage-subtitle')).toHaveText(
			dateLabel(new Date(`${day}T12:00:00Z`))
		);
		await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();

		await page.goto(link);
		await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
		const localDay = new Intl.DateTimeFormat('sv-SE', {
			timeZone: 'America/Los_Angeles'
		}).format(new Date(original.start_time));
		await expect(page.locator('.cal-day[data-selected]')).toHaveAttribute('data-value', localDay);
		await page.getByRole('button', { name: 'Continue', exact: true }).click();
		await expect(page.locator('.stage-subtitle')).toHaveText(
			dateLabel(new Date(original.start_time))
		);
		const currentTime = new Intl.DateTimeFormat('en-US', {
			timeZone: 'America/Los_Angeles',
			hour: '2-digit',
			minute: '2-digit'
		})
			.format(new Date(original.start_time))
			.replace(/\s+/g, '')
			.replace(/^0/, '')
			.toLowerCase();
		await expect(page.getByRole('complementary', { name: 'Reschedule summary' })).toContainText(
			currentTime
		);
		await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
		await page.getByRole('button', { name: 'Confirm', exact: true }).click();
		await page.getByLabel('Reason for rescheduling').fill('The original interval is unchanged');
		await expect(
			page.getByRole('button', { name: 'Confirm Reschedule', exact: true })
		).toBeDisabled();
	});
});

test('an empty weekend timeline keeps its duration toolbar usable without fetching', async ({
	baseURL,
	page
}) => {
	const saturday = new Date();
	saturday.setUTCDate(saturday.getUTCDate() + 7);
	while (saturday.getUTCDay() !== 6) {
		saturday.setUTCDate(saturday.getUTCDate() + 1);
	}
	const day = saturday.toISOString().slice(0, 10);
	await signInAsAdmin(page);
	await page.context().addCookies([
		{
			name: 'tz',
			value: encodeURIComponent('Pacific/Kiritimati'),
			url: baseURL!
		}
	]);
	// Friday's UTC window reaches Saturday here, letting the public UI open that day.
	await page.goto(`/schedule/${slug}?date=${day}`);
	await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
	await expect(page.getByRole('radio').first()).toBeVisible();

	const durationRequests: string[] = [];
	const trackDurationRequest = (request: Request) => {
		if (request.isNavigationRequest() || ['fetch', 'xhr'].includes(request.resourceType())) {
			durationRequests.push(request.url());
		}
	};
	page.on('request', trackDurationRequest);
	await page.getByRole('button', { name: /^Change timezone, currently/ }).click();
	const timezoneDialog = page.getByRole('dialog', { name: 'Choose timezone' });
	await timezoneDialog.getByRole('searchbox').fill('Abidjan');
	await timezoneDialog.getByRole('button', { name: /^Abidjan\b/ }).click();
	await expect(timezoneDialog).not.toBeVisible();
	// Abidjan is UTC year-round: Saturday now has no working-window geometry.
	await expect(page.locator('.timeline-scroll')).toHaveCount(0);
	await expect(page.getByText('No available times on this date.', { exact: true })).toBeVisible();
	await expect(page.getByRole('group', { name: 'Booking settings' })).toBeVisible();
	await expect(durationTrigger(page, 60)).toBeVisible();
	await chooseDuration(page, 60, 90);
	await expect(durationTrigger(page, 90)).toBeVisible();
	await expect(page.getByText('No available times on this date.', { exact: true })).toBeVisible();
	await chooseDuration(page, 90, 25);
	await expect(durationTrigger(page, 25)).toBeVisible();
	await expect(page.locator('.timeline-scroll')).toHaveCount(0);
	await expect(page.getByText('No available times on this date.', { exact: true })).toBeVisible();
	await expect(page.getByText('No availability in the near future.', { exact: true })).toHaveCount(
		0
	);
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	// Remaining bookable days may be in the next month.
	await pickFirstBookableDay(page);
	await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
	await expect(page.getByRole('radio').first()).toBeVisible();
	page.off('request', trackDurationRequest);
	expect(durationRequests).toEqual([]);
});

test('client navigation between meeting slugs replaces duration defaults, choices and maps', async ({
	page
}) => {
	const day = futureWeekday();
	await signInAsAdmin(page);
	await page.goto(`/schedule/${slug}?date=${day}`);
	await chooseDuration(page, 60, 90);
	await expect(durationTrigger(page, 90)).toBeVisible();
	const lateSlot = page.getByRole('radio', { name: /0?4:30\s*PM\s*–\s*0?5:00\s*PM/i });
	await expect(lateSlot).toHaveCount(0);

	await page.evaluate((href) => {
		const anchor = document.createElement('a');
		anchor.id = 'e2e-switch-meeting';
		anchor.href = href;
		anchor.textContent = 'Switch to chat fixture';
		anchor.setAttribute('data-sveltekit-preload-data', 'false');
		document.body.append(anchor);
	}, `/schedule/chat?date=${day}`);
	const documentRequests: string[] = [];
	const trackDocumentRequest = (request: Request) => {
		if (request.isNavigationRequest()) documentRequests.push(request.url());
	};
	page.on('request', trackDocumentRequest);
	await page.getByRole('link', { name: 'Switch to chat fixture', exact: true }).click();
	await expect(page).toHaveURL(`/schedule/chat?date=${day}`);
	await expect(durationTrigger(page, 30)).toBeVisible();
	// The body sentinel survives client routing, but would disappear on a document reload.
	await expect(page.locator('#e2e-switch-meeting')).toHaveCount(1);
	page.off('request', trackDocumentRequest);
	expect(documentRequests).toEqual([]);
	await durationTrigger(page, 30).click();
	const dialog = page.getByRole('dialog', { name: 'How long?' });
	await expect(dialog.locator('.duration-row')).toHaveText(
		hostDurations.filter((duration) => duration !== 25).map((duration) => `${duration} minutes`)
	);
	await expect(dialog.getByRole('button', { name: '25 minutes', exact: true })).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(lateSlot).toBeVisible();
});

test('an enhanced host booking conflict preserves entered fields and the chosen length', async ({
	page
}) => {
	const day = futureWeekday();
	await signInAsAdmin(page);
	await page.goto(`/schedule/${slug}?date=${day}`);
	await chooseDuration(page, 60, 90);
	await page.getByRole('radio', { name: /10:30\s*AM\s*–\s*12:00\s*PM/i }).click();
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	const name = 'Retained Host Guest';
	const email = 'retained-duration@example.test';
	await page.getByLabel('What is your name?').fill(name);
	await page.getByLabel('What is your email?').fill(email);
	await expect(page.locator('input[name="duration"]')).toHaveValue('90');
	const slot = await page.locator('input[name="slot"]').inputValue();
	const blocker = await seedAppointment({
		eventTypeId: slug,
		status: 'confirmed',
		start: new Date(slot),
		durationMinutes: 90
	});
	const responsePromise = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return response.request().method() === 'POST' && url.pathname === `/admin/schedule/${slug}`;
	});
	await page.getByRole('button', { name: 'Request', exact: true }).click();
	const response = await responsePromise;
	const result = await response.json();
	expect(result).toMatchObject({ type: 'failure', status: 409 });
	expect(result.data).toContain('That time is no longer available. Please pick another.');
	await expect(page.getByRole('alert')).toHaveText(
		'That time is no longer available. Please pick another.'
	);
	await expect(page.getByRole('heading', { name: 'Step 3 of 3: Enter your info' })).toBeVisible();
	await expect(page.getByLabel('What is your name?')).toHaveValue(name);
	await expect(page.getByLabel('What is your email?')).toHaveValue(email);
	await expect(page.locator('input[name="duration"]')).toHaveValue('90');
	await expect(page.locator('input[name="slot"]')).toHaveValue(slot);

	// Re-run the same identity's load through public routing, not a document reload.
	await page.evaluate((href) => {
		const anchor = document.createElement('a');
		anchor.id = 'e2e-refresh-meeting';
		anchor.href = href;
		anchor.textContent = 'Refresh this meeting fixture';
		anchor.setAttribute('data-sveltekit-preload-data', 'false');
		document.body.append(anchor);
	}, `/schedule/${slug}?duration=90&date=${day}`);
	const historyLength = await page.evaluate(() => history.length);
	const loadPromise = page.waitForResponse((loadResponse) => {
		const url = new URL(loadResponse.url());
		return (
			loadResponse.request().method() === 'GET' && url.pathname === `/schedule/${slug}/__data.json`
		);
	});
	await page.getByRole('link', { name: 'Refresh this meeting fixture', exact: true }).click();
	const loadResponse = await loadPromise;
	expect(loadResponse.ok()).toBe(true);
	await expect.poll(() => page.evaluate(() => history.length)).toBe(historyLength + 1);
	await expect(page.locator('#e2e-refresh-meeting')).toHaveCount(1);
	await expect(page.getByRole('heading', { name: 'Step 3 of 3: Enter your info' })).toBeVisible();
	await expect(page.getByLabel('What is your name?')).toHaveValue(name);
	await expect(page.getByLabel('What is your email?')).toHaveValue(email);
	await expect(page.locator('input[name="duration"]')).toHaveValue('90');
	await expect(page.locator('input[name="slot"]')).toHaveValue(slot);
	const unchangedBlocker = await readAppointment(blocker.id);
	expect(unchangedBlocker).toEqual(blocker);
	// This checks preservation only, not the deferred same-identity slot-map resync.
});
