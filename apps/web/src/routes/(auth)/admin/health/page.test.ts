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

test('provider auth success is plain feedback only on the matching card, not up health', async () => {
	const pageData: PageData = {
		...data,
		providers: [
			{ ...data.providers[0], observed: { state: 'unobserved', at: null, error: null, via: null } },
			{
				...data.providers[0],
				name: 'other',
				observed: { state: 'unobserved', at: null, error: null, via: null }
			}
		],
		calendars: []
	};
	const form: ActionData = {
		providerTestResult: { provider: 'dav', ok: true, message: 'Authenticated.' }
	};

	const rendered = await render(HealthPage, { props: { data: pageData, form } });
	const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');
	const [providerCard, otherCard] = html.match(/<li class="card[^"]*"[^>]*>[\s\S]*?<\/li>/g) ?? [];

	expect(providerCard).toContain('>dav</h2>');
	expect(providerCard).toMatch(
		/<\/div>\s*<p class="provider-test-result[^"]*" role="status">Authenticated\.<\/p>\s*<\/li>/
	);
	expect(providerCard).toMatch(/<dt[^>]*>Status<\/dt>\s*<dd[^>]*>not observed<\/dd>/);
	expect(providerCard).not.toContain('role="alert"');
	expect(otherCard).toContain('>other</h2>');
	expect(otherCard).not.toContain('Authenticated.');
	expect(otherCard).not.toContain('role="status"');
});

test.each(['wait timed out: <b>sentinel</b>', '401 Authentication failed: <b>sentinel</b>'])(
	'provider auth failure preserves and escapes %s without changing unobserved health',
	async (message) => {
		const pageData: PageData = {
			...data,
			providers: [
				{
					...data.providers[0],
					observed: { state: 'unobserved', at: null, error: null, via: null }
				}
			],
			calendars: []
		};
		const form: ActionData = { providerTestResult: { provider: 'dav', ok: false, message } };

		const rendered = await render(HealthPage, { props: { data: pageData, form } });
		const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');
		const providerCard = html.match(/<li class="card[^"]*"[^>]*>[\s\S]*?<\/li>/)?.[0] ?? '';
		const escapedMessage = message.replaceAll('<', '&lt;');

		expect(providerCard).toContain(`role="status">${escapedMessage}</p>`);
		expect(providerCard).toMatch(/<p class="provider-test-result[^"]*" role="status">/);
		expect(providerCard).not.toContain('<b>sentinel</b>');
		expect(providerCard).not.toContain('role="alert"');
		expect(providerCard).toMatch(/<dt[^>]*>Status<\/dt>\s*<dd[^>]*>not observed<\/dd>/);
	}
);

test('a stored provider failure stays down separately from the current auth test message', async () => {
	const pageData: PageData = { ...data, calendars: [] };
	const form: ActionData = {
		providerTestResult: { provider: 'dav', ok: true, message: 'Authenticated.' }
	};

	const rendered = await render(HealthPage, { props: { data: pageData, form } });
	const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');
	const providerCard = html.match(/<li class="card[^"]*"[^>]*>[\s\S]*?<\/li>/)?.[0] ?? '';
	const banner = providerCard.match(/<aside\b[^>]*role="alert"[^>]*>[\s\S]*?<\/aside>/)?.[0] ?? '';

	expect(banner).toContain('banner-error');
	expect(banner).toContain('down: Authentication denied');
	expect(banner).not.toContain('Authenticated.');
	expect(providerCard).toMatch(/<dt[^>]*>Status<\/dt>\s*<dd class="failed[^"]*">down \(/);
	expect(providerCard).toMatch(
		/<p class="provider-test-result[^"]*" role="status">Authenticated\.<\/p>/
	);
});

test('calendar test failure is escaped footer feedback only on its target, not refresh health', async () => {
	const pageData: PageData = {
		...data,
		providers: [],
		calendars: [data.calendars[0], { ...data.calendars[0], name: 'personal' }]
	};
	const form: ActionData = {
		calendarTestResult: { calendar: 'work', ok: false, message: 'wait timed out: <b>sentinel</b>' }
	};

	const rendered = await render(HealthPage, { props: { data: pageData, form } });
	const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');
	const [calendarCard, otherCard] = html.match(/<li class="card[^"]*"[^>]*>[\s\S]*?<\/li>/g) ?? [];

	expect(calendarCard).toContain('>work</h2>');
	expect(calendarCard).toMatch(
		/<\/div>\s*<p class="calendar-test-result[^"]*\bfeedback-error\b[^"]*" role="status">wait timed out: &lt;b>sentinel&lt;\/b><\/p>\s*<\/li>/
	);
	expect(calendarCard).toContain('refresh freshness unknown');
	expect(calendarCard).toMatch(/<dt[^>]*>Last refresh<\/dt>\s*<dd[^>]*>unknown<\/dd>/);
	expect(calendarCard).not.toContain('role="alert"');
	expect(html).not.toContain('<b>sentinel</b>');
	expect(otherCard).toContain('>personal</h2>');
	expect(otherCard).not.toContain('role="status"');
	expect(otherCard).not.toContain('wait timed out');
});

test('calendar test success keeps count detail separate from a recorded refresh failure', async () => {
	const pageData: PageData = {
		...data,
		providers: [],
		calendars: [{ ...data.calendars[0], health: 'bad', reason: 'Earlier refresh failure' }]
	};
	const form: ActionData = {
		calendarTestResult: {
			calendar: 'work',
			ok: true,
			message: '3 busy intervals over the next 30 days.'
		}
	};

	const rendered = await render(HealthPage, { props: { data: pageData, form } });
	const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');
	const calendarCard = html.match(/<li class="card[^"]*"[^>]*>[\s\S]*?<\/li>/)?.[0] ?? '';
	const banner = calendarCard.match(/<aside\b[^>]*role="alert"[^>]*>[\s\S]*?<\/aside>/)?.[0] ?? '';

	expect(banner).toContain('down: Earlier refresh failure');
	expect(banner).not.toContain('busy intervals');
	expect(calendarCard).toMatch(/<dt[^>]*>Status<\/dt>\s*<dd class="failed[^"]*">down<\/dd>/);
	expect(calendarCard).toMatch(/<dt[^>]*>Last refresh<\/dt>\s*<dd[^>]*>unknown<\/dd>/);
	expect(calendarCard).toMatch(
		/<p class="calendar-test-result[^"]*" role="status">3 busy intervals over the next 30 days\.<\/p>/
	);
	expect(calendarCard).not.toContain('feedback-error');
});

test('discovery lists actual calendar names and config fields only on the matching provider', async () => {
	const pageData: PageData = {
		...data,
		providers: [data.providers[0], { ...data.providers[0], name: 'other' }],
		calendars: []
	};
	const form: ActionData = {
		discoveryResult: {
			provider: 'dav',
			ok: true,
			field: 'href',
			calendars: [
				{ id: 'calendars/owner/work/', name: 'Work <team>', primary: true },
				{ id: 'calendars/owner/personal/', name: 'Personal', primary: false }
			]
		}
	};

	const rendered = await render(HealthPage, { props: { data: pageData, form } });
	const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');
	const [providerCard, otherCard] = html.split(/<li class="card[^"]*"[^>]*>/).slice(1);

	expect(providerCard).toContain('>dav</h2>');
	expect(providerCard).toContain('Available calendars');
	expect(providerCard).toContain('Work &lt;team>');
	expect(providerCard).not.toContain('Work <team>');
	expect(providerCard).toContain('href: calendars/owner/work/');
	expect(providerCard).toContain('Personal');
	expect(providerCard).toContain('href: calendars/owner/personal/');
	expect(providerCard).not.toContain('This provider exposes no calendars.');
	expect(providerCard).not.toContain('Asking the worker');
	expect(otherCard).toContain('>other</h2>');
	expect(otherCard).not.toContain('Available calendars');
	expect(otherCard).not.toContain('calendars/owner/work/');
});

test('only a successful empty discovery shows the empty calendars copy', async () => {
	const form: ActionData = {
		discoveryResult: { provider: 'dav', ok: true, field: 'href', calendars: [] }
	};

	const rendered = await render(HealthPage, { props: { data, form } });
	const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');

	expect(html).toContain('Available calendars');
	expect(html).toContain('This provider exposes no calendars.');
	expect(html).not.toContain('discovery-result');
	expect(html).not.toContain('Asking the worker');
});

test('failed discovery shows its escaped error at the footer, never an empty or loading panel', async () => {
	const form: ActionData = {
		discoveryResult: {
			provider: 'dav',
			ok: false,
			message: '401 Authentication failed: <b>sentinel</b>'
		}
	};

	const rendered = await render(HealthPage, { props: { data, form } });
	const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');
	const providerCard = html.match(/<li class="card[^"]*"[^>]*>[\s\S]*?<\/li>/)?.[0] ?? '';
	const banner = providerCard.match(/<aside\b[^>]*role="alert"[^>]*>[\s\S]*?<\/aside>/)?.[0] ?? '';

	expect(providerCard).toMatch(
		/<\/div>\s*<p class="discovery-result[^"]*\bfeedback-error\b[^"]*" role="status">401 Authentication failed: &lt;b>sentinel&lt;\/b><\/p>\s*<\/li>/
	);
	expect(banner).toContain('down: Authentication denied');
	expect(banner).not.toContain('sentinel');
	expect(html).not.toContain('<b>sentinel</b>');
	expect(html).not.toContain('Available calendars');
	expect(html).not.toContain('This provider exposes no calendars.');
	expect(html).not.toContain('Asking the worker');
	expect(html).not.toMatch(/class="[^"]*\bspinner\b/);
});

test('discovery does not leak results from another provider or persist after a different action', async () => {
	const forms: ActionData[] = [
		null,
		{ discoveryResult: { provider: 'other', ok: true, field: 'href', calendars: [] } },
		{ providerTestResult: { provider: 'dav', ok: true, message: 'Authenticated.' } }
	];

	for (const form of forms) {
		const rendered = await render(HealthPage, { props: { data, form } });
		const html = rendered.body.replace(/<!--[\s\S]*?-->/g, '');

		expect(html).not.toContain('Available calendars');
		expect(html).not.toContain('This provider exposes no calendars.');
		expect(html).not.toContain('discovery-result');
		expect(html).not.toContain('Asking the worker');
	}
});
