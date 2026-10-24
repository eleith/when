import { expect, test } from '@playwright/test';
import { openDb } from '@when/db';
import { signInAsAdmin } from './support/auth.ts';
import { APP_DB_PATH, readAppointment } from './support/database.ts';
import { seedAppointment } from './support/seed.ts';

const slug = 'host-rules';
const postOptions = {
	headers: { origin: 'http://localhost:4183', accept: 'application/json' },
	maxRedirects: 0
};
const adjacentSlot = { name: /9:30\s*AM\s*–\s*10:00\s*AM/i };

function futureWeekday(offset: number): string {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() + offset);
	while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
		date.setUTCDate(date.getUTCDate() + 1);
	}
	return date.toISOString().slice(0, 10);
}

async function rowsForDay(day: string) {
	const db = openDb(APP_DB_PATH);
	try {
		const rows = await db
			.selectFrom('appointments')
			.selectAll()
			.where('event_type_id', '=', slug)
			.where('start_time', '>=', `${day}T00:00:00Z`)
			.where('start_time', '<=', `${day}T23:59:59Z`)
			.orderBy('id')
			.execute();
		return rows;
	} finally {
		await db.destroy();
	}
}

test('host adds beside a busy appointment despite guest buffers and daily cap', async ({
	page,
	request
}, testInfo) => {
	const day = futureWeekday(40 + (testInfo.parallelIndex % 2) + testInfo.retry * 3);
	const busy = await seedAppointment({
		eventTypeId: slug,
		status: 'confirmed',
		start: new Date(`${day}T10:00:00Z`)
	});
	const slot = `${day}T09:30:00Z`;
	const form = { slot, duration: '30', name: 'Host Guest', email: 'host-guest@example.test' };
	const before = await rowsForDay(day);
	const blocked = await request.post(`/schedule/${slug}`, {
		...postOptions,
		form: { ...form, viewer: 'host', role: 'host', isAdmin: 'true' }
	});
	const rejected = await blocked.json();
	expect(rejected).toMatchObject({ type: 'failure', status: 409 });
	const unchanged = await rowsForDay(day);
	expect(unchanged).toEqual(before);

	await signInAsAdmin(page);
	// A host session does not promote submissions to a guest action endpoint.
	const hostOnGuestRoute = await page.request.post(`/schedule/${slug}`, { ...postOptions, form });
	const guestRouteResult = await hostOnGuestRoute.json();
	expect(guestRouteResult).toMatchObject({ type: 'failure', status: 409 });
	const afterHostGuestPost = await rowsForDay(day);
	expect(afterHostGuestPost).toEqual(before);
	await page.goto(`/schedule/${slug}?date=${day}`);
	const target = page.getByRole('radio', adjacentSlot);
	await expect(target).toBeVisible();
	await expect(page.locator('.busy-block')).toHaveCount(1);
	await expect(page.locator('.buffer-zone')).toHaveCount(1);
	const busyStyle = await page.locator('.busy-block').getAttribute('style');
	await expect(page.locator('.buffer-zone')).toHaveAttribute('style', busyStyle!);
	await target.click();
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(page.locator('#appointment-form')).toHaveAttribute(
		'action',
		`/admin/schedule/${slug}`
	);
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
	expect(Date.parse(created.end_time) - Date.parse(created.start_time)).toBe(30 * 60_000);
	expect(Date.parse(created.end_time)).toBe(Date.parse(busy.start_time));

	const stillBlocked = await request.post(`/schedule/${slug}`, {
		...postOptions,
		form: { ...form, slot: `${day}T15:00:00Z` }
	});
	const guestRejected = await stillBlocked.json();
	expect(guestRejected).toMatchObject({ type: 'failure', status: 409 });
	const overlap = await page.request.post(`/admin/schedule/${slug}`, {
		...postOptions,
		form: { ...form, slot: busy.start_time }
	});
	const overlapRejected = await overlap.json();
	expect(overlapRejected).toMatchObject({ type: 'failure', status: 409 });
	const unsupported = await page.request.post(`/admin/schedule/${slug}`, {
		...postOptions,
		form: { ...form, slot: `${day}T15:00:00Z`, duration: '75' }
	});
	const durationRejected = await unsupported.json();
	expect(durationRejected).toMatchObject({ type: 'failure', status: 400 });
	const finalRows = await rowsForDay(day);
	expect(finalRows.map((row) => row.id).sort()).toEqual([busy.id, id].sort());
});

test('host reschedules beside another meeting while the guest remains buffered', async ({
	page,
	request
}, testInfo) => {
	const day = futureWeekday(50 + (testInfo.parallelIndex % 2) + testInfo.retry * 3);
	const original = await seedAppointment({
		eventTypeId: slug,
		status: 'confirmed',
		start: new Date(`${day}T14:00:00Z`)
	});
	const busy = await seedAppointment({ status: 'confirmed', start: new Date(`${day}T10:00:00Z`) });
	const publicPath = `/appointment/${original.id}/reschedule`;
	const privatePath = `/admin/appointment/${original.id}/reschedule`;
	const slot = `${day}T09:30:00Z`;
	const form = {
		slot,
		duration: '30',
		token: original.cancel_token,
		name: original.guest_name,
		email: original.guest_email!,
		reschedule_reason: 'Moving earlier'
	};
	const before = await rowsForDay(day);
	const blocked = await request.post(publicPath, {
		...postOptions,
		form: { ...form, viewer: 'host', role: 'host', isAdmin: 'true' }
	});
	const rejected = await blocked.json();
	expect(rejected).toMatchObject({ type: 'failure', status: 409 });
	const unchanged = await rowsForDay(day);
	expect(unchanged).toEqual(before);

	await signInAsAdmin(page);
	const hostOnGuestRoute = await page.request.post(publicPath, { ...postOptions, form });
	const guestRouteResult = await hostOnGuestRoute.json();
	expect(guestRouteResult).toMatchObject({ type: 'failure', status: 409 });
	const afterHostGuestPost = await rowsForDay(day);
	expect(afterHostGuestPost).toEqual(before);
	await page.goto(`${publicPath}?token=${original.cancel_token}&date=${day}`);
	await expect(page.getByRole('radio', adjacentSlot)).toBeVisible();
	const overlap = await page.request.post(privatePath, {
		...postOptions,
		form: { ...form, slot: busy.start_time }
	});
	const overlapRejected = await overlap.json();
	expect(overlapRejected).toMatchObject({ type: 'failure', status: 409 });
	const moved = await page.request.post(privatePath, { ...postOptions, form });
	const redirect = await moved.json();
	expect(redirect).toMatchObject({ type: 'redirect', status: 303 });
	const location = redirect.location;
	expect(location).toMatch(/^\/appointment\/[^/?]+$/);
	const id = location.split('/').at(-1)!;
	expect(id).not.toBe(original.id);
	const old = await readAppointment(original.id);
	const next = await readAppointment(id);
	expect(old.status).toBe('rescheduled');
	expect(next).toMatchObject({
		event_type_id: slug,
		status: 'confirmed',
		guest_name: original.guest_name,
		guest_email: original.guest_email,
		guest_timezone: 'UTC'
	});
	expect(Date.parse(next.start_time)).toBe(Date.parse(slot));
	expect(Date.parse(next.end_time) - Date.parse(next.start_time)).toBe(30 * 60_000);
	expect(Date.parse(next.end_time)).toBe(Date.parse(busy.start_time));
	const finalRows = await rowsForDay(day);
	expect(finalRows.map((row) => row.id).sort()).toEqual([original.id, id].sort());
});
