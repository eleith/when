import { expect, test, vi } from 'vitest';
import { render } from 'svelte/server';
import HealthPage from './+page.svelte';
import type { PageData } from './$types';
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
