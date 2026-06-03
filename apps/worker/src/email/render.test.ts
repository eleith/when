import { describe, expect, test } from 'vitest';
import { renderEmail } from './render.js';

describe('renderEmail (Eta + MJML harness)', () => {
	test('renders a template end-to-end: layout, loop, conditional, escaping', async () => {
		const html = await renderEmail('render-probe.mjml', {
			orgName: 'When',
			footerHref: 'https://when.example.com/booked/1',
			heading: 'Hello & welcome',
			rows: [
				{ label: 'What', value: '30 min chat' },
				{ label: 'When', value: 'Mon 9am' }
			],
			note: 'see you <soon>',
			actionHref: 'https://when.example.com/cancel',
			actionLabel: 'Cancel'
		});

		expect(html.toLowerCase()).toContain('<!doctype html');
		expect(html).toContain('When'); // layout header
		expect(html).toContain('30 min chat'); // loop row
		expect(html).toContain('Mon 9am');
		expect(html).toContain('Hello &amp; welcome'); // auto-escaped interpolation
		expect(html).toContain('see you &lt;soon&gt;'); // conditional block + escaped
		expect(html).toContain('Cancel'); // button
		expect(html).toContain('Manage your booking'); // layout footer
	});

	test('omits the conditional block when data is absent', async () => {
		const html = await renderEmail('render-probe.mjml', {
			orgName: 'When',
			footerHref: 'https://when.example.com',
			heading: 'No note here',
			rows: [{ label: 'What', value: 'chat' }],
			note: '',
			actionHref: 'https://when.example.com/x',
			actionLabel: 'Go'
		});
		expect(html).toContain('No note here');
		expect(html).not.toContain('see you');
	});
});
