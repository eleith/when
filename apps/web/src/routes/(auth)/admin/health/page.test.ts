import { expect, test, vi } from 'vitest';
import { render } from 'svelte/server';
import HealthPage from './+page.svelte';
import type { ActionData, PageData } from './$types';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('$app/state', () => ({
	page: { url: new URL('https://book.example.com/admin/health') }
}));

const data: PageData = {
	session: { expires: '2026-05-01T12:00:00Z' },
	preferredTimezone: null,
	appearance: validConfig.user.appearance,
	ogImage: 'https://book.example.com/og.png',
	providers: [
		{
			name: 'dav',
			type: 'caldav',
			usesOAuth: false,
			connected: false,
			calendars: ['work'],
			observed: { state: 'failing', error: 'Authentication denied', at: null, via: 'test' },
			endpoint: { label: 'URL', url: 'https://dav.example.com' }
		}
	],
	calendars: [
		{
			name: 'work',
			type: 'caldav',
			provider: 'dav',
			target: { field: 'href', value: 'work/' },
			refreshEveryMinutes: 10,
			health: 'unknown',
			reason: null,
			lastSyncedAt: null
		}
	],
	smtp: {
		host: 'smtp.example.com',
		port: 587,
		username: 'mailer',
		sender: 'noreply@example.com',
		defaultRecipient: 'host@example.com',
		observed: { state: 'unobserved', at: null, error: null, via: null }
	},
	worker: { url: 'http://worker:9000' },
	meetings: []
};

test('calendar copy describes unknown refresh evidence, separately from provider errors', async () => {
	const rendered = await render(HealthPage, { props: { data, form: null } });
	const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');

	expect(html).toContain('refresh freshness unknown');
	expect(html).toMatch(/<dt[^>]*>Last refresh<\/dt>\s*<dd[^>]*>unknown<\/dd>/);
	expect(html).toContain('down: Authentication denied');
});

test('explicit calendar failure keeps its error without displaying an untrusted refresh time', async () => {
	const failedData: PageData = {
		...data,
		calendars: [{ ...data.calendars[0], health: 'bad', reason: 'Refresh failed' }]
	};
	const rendered = await render(HealthPage, { props: { data: failedData, form: null } });
	const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');

	expect(html).toContain('down: Refresh failed');
	expect(html).toMatch(/<dt[^>]*>Last refresh<\/dt>\s*<dd[^>]*>unknown<\/dd>/);
	expect(html).not.toContain('Never synced');
});

test('a test timeout preserves and escapes its message without changing unobserved SMTP health', async () => {
	const pageData: PageData = { ...data, providers: [], calendars: [] };
	const message = 'wait timed out: <b>sentinel</b>';
	const form: ActionData = { emailResult: { ok: false, message } };

	const rendered = await render(HealthPage, { props: { data: pageData, form } });
	const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');

	expect(html).toMatch(
		/<\/form>\s*<\/div>\s*<p class="email-result[^"]*" role="status">wait timed out: &lt;b>sentinel&lt;\/b><\/p>/
	);
	expect(html).not.toContain('<b>sentinel</b>');
	expect(html).not.toContain('role="alert"');
	expect(html).toMatch(/<dt[^>]*>Status<\/dt>\s*<dd[^>]*>not observed<\/dd>/);
});

test('a successful test displays its message as plain feedback, not up health', async () => {
	const pageData: PageData = { ...data, providers: [], calendars: [] };
	const message = 'Test email sent to host@example.com.';
	const form: ActionData = { emailResult: { ok: true, message } };

	const rendered = await render(HealthPage, { props: { data: pageData, form } });
	const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');

	expect(html).toMatch(
		/<\/form>\s*<\/div>\s*<p class="email-result[^"]*" role="status">Test email sent to host@example\.com\.<\/p>/
	);
	expect(html).not.toContain('role="alert"');
	expect(html).toMatch(/<dt[^>]*>Status<\/dt>\s*<dd[^>]*>not observed<\/dd>/);
});

test('a stored SMTP failure stays down separately from the current test error', async () => {
	const pageData: PageData = {
		...data,
		providers: [],
		calendars: [],
		smtp: {
			...data.smtp,
			observed: { state: 'failing', error: 'Earlier SMTP failure', at: null, via: 'test' }
		}
	};
	const message = '535 Authentication failed';
	const form: ActionData = { emailResult: { ok: false, message } };

	const rendered = await render(HealthPage, { props: { data: pageData, form } });
	const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');
	const banner = html.match(/<aside\b[^>]*role="alert"[^>]*>[\s\S]*?<\/aside>/)?.[0] ?? '';

	expect(banner).toContain('banner-error');
	expect(banner).toContain('down: Earlier SMTP failure');
	expect(banner).not.toContain(message);
	expect(html).toMatch(/<dt[^>]*>Status<\/dt>\s*<dd class="failed[^"]*">down \(/);
	expect(html).toMatch(
		/<\/form>\s*<\/div>\s*<p class="email-result[^"]*" role="status">535 Authentication failed<\/p>/
	);
});

test('a saved SMTP failure still displays a down banner without an action notice', async () => {
	const pageData: PageData = {
		...data,
		providers: [],
		calendars: [],
		smtp: {
			...data.smtp,
			observed: { state: 'failing', error: 'Earlier SMTP failure', at: null, via: 'test' }
		}
	};

	const rendered = await render(HealthPage, { props: { data: pageData, form: null } });
	const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');
	const banner = html.match(/<aside\b[^>]*role="alert"[^>]*>[\s\S]*?<\/aside>/)?.[0] ?? '';

	expect(banner).toContain('banner-error');
	expect(banner).toContain('down: Earlier SMTP failure');
	expect(banner).not.toContain('Last recorded failure:');
	expect(html).toMatch(/<dt[^>]*>Status<\/dt>\s*<dd class="failed[^"]*">down \(/);
});
