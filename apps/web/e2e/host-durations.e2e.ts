import { expect, test, type Page, type Request } from '@playwright/test';
import { signInAsAdmin } from './support/auth.ts';
import { readAppointment } from './support/database.ts';
import { seedAppointment } from './support/seed.ts';

const slug = 'host-durations';
const hostDurations = [15, 25, 30, 45, 60, 90, 120, 180, 240, 300];
const postOptions = {
	headers: { origin: 'http://localhost:4183', accept: 'application/json' },
	maxRedirects: 0
};
const forgedHost = { role: 'host', viewer: 'host', isAdmin: 'true' };

function futureWeekday(offset: number, retry: number): string {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() + offset);
	for (let attempt = 0; attempt <= retry; attempt++) {
		if (attempt > 0) date.setUTCDate(date.getUTCDate() + 1);
		while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
			date.setUTCDate(date.getUTCDate() + 1);
		}
	}
	return date.toISOString().slice(0, 10);
}

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

test('host uses the configured default and finite palette, recovering locally from no availability', async ({
	page,
	request
}, testInfo) => {
	const day = futureWeekday(14, testInfo.retry);
	await signInAsAdmin(page);
	await page.goto(`/schedule/${slug}?date=${day}`);
	await expect(durationTrigger(page, 60)).toBeVisible();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
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
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Step 2 of 3: Pick a time' })).toBeVisible();
	await expect(durationTrigger(page, 90)).toBeVisible();
	const target = page.getByRole('radio', { name: /10:30\s*AM\s*–\s*12:00\s*PM/i });
	await expect(target).toBeVisible();
	page.off('request', trackDurationRequest);
	expect(durationRequests).toEqual([]);

	await target.click();
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(page.locator('#appointment-form')).toHaveAttribute(
		'action',
		`/admin/schedule/${slug}`
	);
	await expect(page.locator('input[name="duration"]')).toHaveValue('90');
	const slot = await page.locator('input[name="slot"]').inputValue();
	expect(Date.parse(slot)).toBe(Date.parse(`${day}T10:30:00Z`));
	const form = {
		slot,
		duration: '90',
		name: 'Host Duration Guest',
		email: 'duration@example.test'
	};
	for (const client of [request, page.request]) {
		// Neither a forged current length nor a real host cookie promotes the public action.
		const rejected = await client.post(`/schedule/${slug}`, {
			...postOptions,
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

test('rescheduling defaults to the trusted current 90 for both roles and omission preserves it', async ({
	page,
	request
}, testInfo) => {
	// Between the existing host-availability cases at roughly 40 and 50 days.
	const day = futureWeekday(45, testInfo.retry);
	const original = await seedAppointment({
		eventTypeId: slug,
		status: 'confirmed',
		start: new Date(`${day}T09:00:00Z`),
		durationMinutes: 90
	});
	const publicPath = `/appointment/${original.id}/reschedule`;
	const link = `${publicPath}?token=${original.cancel_token}&date=${day}`;
	await page.goto(link);
	await expect(durationTrigger(page, 90)).toBeVisible();
	await durationTrigger(page, 90).click();
	const dialog = page.getByRole('dialog', { name: 'How long?' });
	await expect(dialog.locator('.duration-row')).toHaveText([
		'60 minutes',
		'25 minutes',
		'90 minutes'
	]);
	await expect(dialog.getByRole('button', { name: '120 minutes', exact: true })).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();

	const form = {
		slot: `${day}T10:30:00Z`,
		token: original.cancel_token,
		name: original.guest_name,
		email: original.guest_email!,
		timezone: 'UTC',
		reschedule_reason: 'Keep the booked length at a new time'
	};
	const forged = { ...form, ...forgedHost, currentDuration: '120', duration: '120' };
	const rejected = await request.post(publicPath, { ...postOptions, form: forged });
	const rejectedResult = await rejected.json();
	expect(rejectedResult).toMatchObject({ type: 'failure', status: 400 });
	const sameStart = await request.post(publicPath, {
		...postOptions,
		form: { ...form, slot: original.start_time, duration: '25' }
	});
	const sameStartResult = await sameStart.json();
	expect(sameStartResult).toMatchObject({ type: 'failure', status: 400 });

	await signInAsAdmin(page);
	await page.goto(link);
	await expect(durationTrigger(page, 90)).toBeVisible();
	await durationTrigger(page, 90).click();
	await expect(dialog.locator('.duration-row')).toHaveText(
		hostDurations.map((duration) => `${duration} minutes`)
	);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	const hostOnPublic = await page.request.post(publicPath, { ...postOptions, form: forged });
	const hostOnPublicResult = await hostOnPublic.json();
	expect(hostOnPublicResult).toMatchObject({ type: 'failure', status: 400 });
	const hostSameStart = await page.request.post(`/admin/appointment/${original.id}/reschedule`, {
		...postOptions,
		form: { ...form, slot: original.start_time, duration: '25' }
	});
	const hostSameStartResult = await hostSameStart.json();
	expect(hostSameStartResult).toMatchObject({ type: 'failure', status: 400 });
	const unchanged = await readAppointment(original.id);
	expect(unchanged).toEqual(original);

	// Omit duration entirely; even a forged currentDuration must not replace the row's length.
	const moved = await request.post(publicPath, {
		...postOptions,
		form: { ...form, ...forgedHost, currentDuration: '120' }
	});
	const redirect = await moved.json();
	expect(redirect).toMatchObject({ type: 'redirect', status: 303 });
	expect(redirect.location).toMatch(/^\/appointment\/[^/?]+\?token=.+/);
	const id = new URL(redirect.location, 'http://localhost:4183').pathname.split('/').at(-1)!;
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

test('guest can change a booked host-only 90 to configured 25, but cannot invent 75', async ({
	page,
	request
}, testInfo) => {
	const day = futureWeekday(24, testInfo.retry);
	const original = await seedAppointment({
		eventTypeId: slug,
		status: 'confirmed',
		start: new Date(`${day}T09:00:00Z`),
		durationMinutes: 90
	});
	const publicPath = `/appointment/${original.id}/reschedule`;
	const reason = 'Use the shorter configured length';
	const rejected = await request.post(publicPath, {
		...postOptions,
		form: {
			slot: `${day}T10:30:00Z`,
			duration: '75',
			currentDuration: '75',
			...forgedHost,
			token: original.cancel_token,
			name: original.guest_name,
			email: original.guest_email!,
			reschedule_reason: reason
		}
	});
	const rejectedResult = await rejected.json();
	expect(rejectedResult).toMatchObject({ type: 'failure', status: 400 });
	const unchanged = await readAppointment(original.id);
	expect(unchanged).toEqual(original);

	await page.goto(`${publicPath}?token=${original.cancel_token}&date=${day}`);
	await expect(durationTrigger(page, 90)).toBeVisible();
	await chooseDuration(page, 90, 25);
	await expect(durationTrigger(page, 25)).toBeVisible();
	await page.getByRole('radio', { name: /10:30\s*AM\s*–\s*10:55\s*AM/i }).click();
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(page.locator('#appointment-form')).toHaveAttribute('action', publicPath);
	await expect(page.locator('input[name="duration"]')).toHaveValue('25');
	await expect(page.getByLabel('What is your name?')).toHaveValue(original.guest_name);
	await expect(page.getByLabel('What is your name?')).toBeEnabled();
	await expect(page.getByLabel('What is your email?')).toHaveValue(original.guest_email!);
	await expect(page.getByLabel('What is your email?')).toBeEnabled();
	const slot = await page.locator('input[name="slot"]').inputValue();
	await page.getByLabel('Reason for rescheduling').fill(reason);
	await page.getByRole('button', { name: 'Confirm Reschedule', exact: true }).click();
	await page.waitForURL(/\/appointment\/[^/?]+\?token=.+/);

	const id = new URL(page.url()).pathname.split('/').at(-1)!;
	expect(id).not.toBe(original.id);
	const old = await readAppointment(original.id);
	const next = await readAppointment(id);
	expect(old.status).toBe('rescheduled');
	expect(next).toMatchObject({
		event_type_id: slug,
		status: 'pending',
		origin_id: original.id,
		guest_name: original.guest_name,
		guest_email: original.guest_email
	});
	expect(Date.parse(next.start_time)).toBe(Date.parse(slot));
	expect(Date.parse(next.start_time)).not.toBe(Date.parse(original.start_time));
	expect(Date.parse(next.end_time) - Date.parse(next.start_time)).toBe(25 * 60_000);
});

test('an empty weekend timeline keeps its duration toolbar usable without fetching', async ({
	page
}, testInfo) => {
	const saturday = new Date();
	saturday.setUTCDate(saturday.getUTCDate() + 7 + testInfo.retry * 7);
	while (saturday.getUTCDay() !== 6) {
		saturday.setUTCDate(saturday.getUTCDate() + 1);
	}
	const day = saturday.toISOString().slice(0, 10);
	await signInAsAdmin(page);
	await page.context().addCookies([
		{
			name: 'tz',
			value: encodeURIComponent('Pacific/Kiritimati'),
			url: 'http://localhost:4183'
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
	await expect(page.getByRole('group', { name: 'Duration selector' })).toBeVisible();
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
	await expect(
		page.locator('.cal-day:not([data-unavailable]):not([data-disabled])').first()
	).toBeVisible();
	page.off('request', trackDurationRequest);
	expect(durationRequests).toEqual([]);
});

test('client navigation between meeting slugs replaces duration defaults, choices and maps', async ({
	page
}, testInfo) => {
	const day = futureWeekday(20, testInfo.retry);
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
		anchor.setAttribute('data-sveltekit-preload-data', 'off');
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
}, testInfo) => {
	const day = futureWeekday(34, testInfo.retry);
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
		anchor.setAttribute('data-sveltekit-preload-data', 'off');
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
