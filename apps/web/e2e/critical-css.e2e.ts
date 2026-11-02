import { expect, test } from './support/test.ts';
import { seedAppointment } from './support/seed.ts';

test.use({ javaScriptEnabled: false });

for (const viewport of [
	{ name: 'mobile', width: 390, height: 844 },
	{ name: 'desktop', width: 1280, height: 900 }
]) {
	test(`booking and rescheduling have inline initial styles on ${viewport.name}`, async ({
		page
	}) => {
		await page.setViewportSize(viewport);
		// The first render must not depend on an external stylesheet or hydration.
		await page.route('**/_app/immutable/assets/*.css', (route) => route.abort());
		const appointment = await seedAppointment();
		const paths = [
			'/schedule/chat',
			`/appointment/${appointment.id}/reschedule?token=${appointment.cancel_token}`
		];

		for (const path of paths) {
			const response = await page.goto(path);
			expect(response?.status()).toBe(200);
			await expect(page.getByRole('heading', { name: 'Step 1 of 3: Pick a day' })).toBeVisible();
			await expect(page.locator('head link[rel="stylesheet"]:not([disabled])')).toHaveCount(0);
			await expect(page.locator('.card-stage')).toHaveCSS('display', 'flex');
			await expect(page.locator('.page-banner')).toHaveCSS(
				'display',
				viewport.name === 'mobile' ? 'flex' : 'none'
			);
		}
	});
}
