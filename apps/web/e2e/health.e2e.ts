import { expect, test } from '@playwright/test';
import { signInAsAdmin } from './support/auth.ts';

test('an unreachable worker shows plain SMTP test feedback without retrying', async ({ page }) => {
	await signInAsAdmin(page);
	await page.goto('/admin/health');

	let emailPosts = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().endsWith('/admin/health?/email')) {
			emailPosts++;
		}
	});

	const smtpCard = page.locator('.card').filter({
		has: page.getByRole('heading', { name: 'smtp.example.test', exact: true })
	});
	const form = smtpCard.locator('form.email-form');
	await expect(form).toHaveAttribute('action', '?/email');
	await expect(form.getByRole('textbox')).toHaveValue('e2e@example.test');
	await form.getByRole('button', { name: 'Send', exact: true }).click();

	const feedback = smtpCard.getByRole('status');
	await expect(feedback).toHaveText('Worker not reachable.');
	await expect(feedback).toHaveClass(/\bemail-result\b/);
	await expect(smtpCard.getByRole('alert')).toHaveCount(0);
	const status = smtpCard
		.locator('dt')
		.filter({ hasText: /^Status$/ })
		.locator('+ dd');
	await expect(status).toHaveText('not observed');
	await expect(form.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
	expect(emailPosts).toBe(1);
});
