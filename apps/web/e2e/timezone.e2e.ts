import { expect, test } from './support/test.ts';
import { readAppointment } from './support/database.ts';
import { CHAT_MEETING } from './support/seed.ts';
import { pickLastBookableDay, pickSlotFromEndOfDay } from './support/wizard.ts';

const timezone = 'Pacific/Kiritimati';
test.use({ timezoneId: timezone, locale: 'en-US' });

test('an absolute slot link books the same instant on the browser timezone’s next day', async ({
	page,
	context,
	browser,
	baseURL
}) => {
	// Discover a real late UTC slot; availability belongs to the app, not this test.
	const discovery = await browser.newPage({ baseURL, timezoneId: 'UTC' });
	let slot: string;
	try {
		await discovery.goto(`/schedule/${CHAT_MEETING.slug}`);
		await pickLastBookableDay(discovery);
		await pickSlotFromEndOfDay(discovery);
		await discovery.getByRole('button', { name: 'Confirm', exact: true }).click();
		slot = await discovery.locator('input[name="slot"]').inputValue();
	} finally {
		await discovery.close();
	}

	const start = new Date(slot);
	const end = new Date(start.getTime() + CHAT_MEETING.durationMinutes * 60_000);
	const localFormat = (options: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat('en-US', { ...options, timeZone: timezone });
	const compactDate = localFormat({ weekday: 'short', month: 'short', day: 'numeric' }).format(
		start
	);
	const time = localFormat({ hour: '2-digit', minute: '2-digit' });
	const shortTime = localFormat({ hour: 'numeric', minute: '2-digit' })
		.format(start)
		.replace(/\s+/g, '')
		.toLowerCase();
	const date = localFormat({ year: 'numeric', month: 'numeric', day: 'numeric' }).format(start);
	expect(localFormat({ day: 'numeric' }).format(start)).not.toBe(String(start.getUTCDate()));
	const initialCookies = await context.cookies();
	expect(initialCookies.find((cookie) => cookie.name === 'tz')).toBeUndefined();

	await page.goto(`/schedule/${CHAT_MEETING.slug}?slot=${encodeURIComponent(slot)}`);
	await expect(page.getByRole('heading', { name: 'Step 3 of 3: Enter your info' })).toBeVisible();
	await expect(
		page.getByRole('paragraph').filter({ hasText: `${compactDate} at ${shortTime}` })
	).toBeVisible();
	await expect(page.locator('input[name="slot"]')).toHaveValue(slot);
	await expect(page.locator('input[name="timezone"]')).toHaveValue(timezone);
	const initializedCookies = await context.cookies();
	expect(decodeURIComponent(initializedCookies.find((cookie) => cookie.name === 'tz')!.value)).toBe(
		timezone
	);
	await page.getByLabel('What is your name?').fill('Timezone Guest');
	await page.getByLabel('What is your email?').fill('timezone@example.test');
	await page.getByRole('button', { name: 'Request', exact: true }).click();
	await page.waitForURL(/\/appointment\/[^/?]+\?token=.+/);
	await expect(page.getByRole('heading', { name: 'Appointment requested' })).toBeVisible();

	const id = new URL(page.url()).pathname.split('/').at(-1)!;
	const row = await readAppointment(id);
	expect(Date.parse(row.start_time)).toBe(start.getTime());
	expect(Date.parse(row.end_time)).toBe(end.getTime());
	expect(row.guest_timezone).toBe(timezone);

	await expect(page.getByText(date, { exact: true })).toBeVisible();
	await expect(
		page.getByText(`${time.format(start)} – ${time.format(end)}`, { exact: true })
	).toBeVisible();
	await page.reload();
	await expect(page.getByText(date, { exact: true })).toBeVisible();
	await expect(
		page.getByText(`${time.format(start)} – ${time.format(end)}`, { exact: true })
	).toBeVisible();
});
