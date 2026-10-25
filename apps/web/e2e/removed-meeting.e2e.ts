import { expect, test } from '@playwright/test';
import { openDb } from '@when/db';
import { signInAsAdmin } from './support/auth.ts';
import { APP_DB_PATH, readAppointment } from './support/database.ts';
import { seedAppointment } from './support/seed.ts';

const postOptions = {
	headers: { origin: 'http://localhost:4183', accept: 'application/json' },
	maxRedirects: 0
};

function futureWeekday(retry: number): string {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() + 52);
	for (let index = 0; index <= retry; index++) {
		if (index > 0) date.setUTCDate(date.getUTCDate() + 1);
		while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
			date.setUTCDate(date.getUTCDate() + 1);
		}
	}
	return date.toISOString().slice(0, 10);
}

test('host sees a marked historical fallback from a real booking snapshot, while guests remain denied', async ({
	page,
	request
}, testInfo) => {
	await signInAsAdmin(page);
	const day = futureWeekday(testInfo.retry);
	const created = await page.request.post('/admin/schedule/chat', {
		...postOptions,
		form: {
			slot: `${day}T13:30:00Z`,
			duration: '30',
			timezone: 'UTC',
			name: 'Historical Guest',
			email: 'historical-guest@example.test'
		}
	});
	const redirect = await created.json();
	expect(redirect).toMatchObject({ type: 'redirect', status: 303 });
	const id = new URL(redirect.location, 'http://localhost:4183').pathname.split('/').at(-1)!;
	const booked = await readAppointment(id);
	const snapshot = JSON.parse(booked.meeting_snapshot!);
	expect(snapshot).toEqual({
		title: '30-minute chat',
		duration_minutes: 30,
		description: 'A quick introductory call.',
		slug: 'chat'
	});
	expect(snapshot).not.toHaveProperty('additional_duration_minutes');

	// Exercise the missing-config branch without editing running configuration.
	// The historical snapshot is exactly what the production booking service wrote.
	const db = openDb(APP_DB_PATH);
	try {
		await db
			.updateTable('appointments')
			.set({ event_type_id: 'removed-meeting' })
			.where('id', '=', id)
			.executeTakeFirstOrThrow();
	} finally {
		await db.destroy();
	}
	const beforeView = await readAppointment(id);
	const guest = await request.get(`/appointment/${id}?token=${booked.cancel_token}`);
	expect(guest.status()).toBe(404);
	const response = await page.goto(`/appointment/${id}`);
	expect(response?.status()).toBe(200);
	await expect(page.getByRole('heading', { name: snapshot.title, exact: true })).toBeVisible();
	await expect(page.getByText(snapshot.description, { exact: true })).toBeVisible();
	await expect(page.getByRole('alert')).toContainText('This meeting type is no longer configured.');
	await expect(page.getByRole('alert')).toContainText('Showing saved appointment details');
	await expect(page.getByText('Historical Guest', { exact: false })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Appointment actions', exact: true })).toHaveCount(
		0
	);
	await expect(page.getByRole('button', { name: 'Add to calendar', exact: true })).toHaveCount(0);
	await expect(page.getByRole('dialog', { name: 'Change duration', exact: true })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Admin dashboard', exact: true })).toBeVisible();

	const duration = await page.request.post(`/admin/appointment/${id}?/changeDuration`, {
		...postOptions,
		form: { duration: '60' }
	});
	const durationResult = await duration.json();
	expect(durationResult).toMatchObject({ type: 'failure', status: 409 });
	const move = await page.request.post(`/admin/appointment/${id}/reschedule`, {
		...postOptions,
		form: { slot: `${day}T15:00:00Z`, duration: '30', reschedule_reason: 'Not available' }
	});
	const moveResult = await move.json();
	expect(moveResult).toMatchObject({ type: 'failure', status: 409 });
	const afterView = await readAppointment(id);
	expect(afterView).toEqual(beforeView);
});

test('missing or corrupt historical details return a deliberate 404 rather than a server crash', async ({
	page,
	request
}) => {
	await signInAsAdmin(page);
	for (const snapshot of [null, '{broken']) {
		const row = await seedAppointment({ eventTypeId: 'removed-unusable', status: 'confirmed' });
		if (snapshot !== null) {
			const db = openDb(APP_DB_PATH);
			try {
				await db
					.updateTable('appointments')
					.set({ meeting_snapshot: snapshot })
					.where('id', '=', row.id)
					.executeTakeFirstOrThrow();
			} finally {
				await db.destroy();
			}
		}
		const response = await page.goto(`/appointment/${row.id}`);
		expect(response?.status()).toBe(404);
		await expect(
			page.getByText('Saved meeting details are unavailable.', { exact: true })
		).toBeVisible();
		const guest = await request.get(`/appointment/${row.id}?token=${row.cancel_token}`);
		expect(guest.status()).toBe(404);
	}
});
