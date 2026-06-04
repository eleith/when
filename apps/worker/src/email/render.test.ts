import { describe, expect, test } from 'vitest';
import { renderHtmlBody, renderTextBody } from './render.js';
import type { EmailContent } from './content.js';

const base: Omit<EmailContent, 'actions'> = {
	brand: { name: 'Acme', primaryColor: '#2563eb' },
	heading: 'Hello & welcome',
	paragraphs: ['Thanks for booking.'],
	rows: [
		{ label: 'What', value: '30 min chat' },
		{ label: 'When', value: 'Mon 9am' },
		{ label: 'Where', value: null }
	],
	footerHref: 'https://when.example.com/booked/1'
};

describe('renderHtmlBody', () => {
	test('no actions: shell + header + heading + body, no buttons', () => {
		const html = renderHtmlBody({ ...base, actions: [] });
		expect(html.toLowerCase()).toContain('<!doctype html');
		expect(html).toContain('Acme');
		expect(html).toContain('Hello &amp; welcome');
		expect(html).toContain('Thanks for booking.');
		expect(html).toContain('30 min chat');
		expect(html).not.toContain('>Where<');
		expect(html).toContain('Powered by When');
		expect(html).not.toContain('mso-padding-alt');
	});

	test('renders a button per action with its href and label', () => {
		const html = renderHtmlBody({
			...base,
			actions: [
				{ href: 'https://x/resched', label: 'Reschedule', variant: 'secondary' },
				{ href: 'https://x/cancel', label: 'Cancel', variant: 'danger' }
			]
		});
		expect(html).toContain('https://x/resched');
		expect(html).toContain('Reschedule');
		expect(html).toContain('https://x/cancel');
		expect(html).toContain('Cancel');
	});

	test('primary button uses the brand color', () => {
		const html = renderHtmlBody({
			...base,
			actions: [{ href: 'https://x/review', label: 'Review request', variant: 'primary' }]
		});
		expect(html).toContain('https://x/review');
		expect(html).toContain('Review request');
		expect(html).toContain('#2563eb');
	});

	test('uses the logo image when configured', () => {
		const html = renderHtmlBody({
			...base,
			actions: [],
			brand: { name: 'Acme', primaryColor: '#2563eb', logoUrl: 'https://cdn/logo.png' }
		});
		expect(html).toContain('https://cdn/logo.png');
	});
});

describe('renderTextBody', () => {
	test('composes heading, paragraphs, rows, and actions', () => {
		const text = renderTextBody({
			...base,
			actions: [
				{ href: 'https://x/resched', label: 'Reschedule', variant: 'secondary' },
				{ href: 'https://x/cancel', label: 'Cancel', variant: 'danger' }
			]
		});
		expect(text).toBe(
			[
				'Hello & welcome',
				'',
				'Thanks for booking.',
				'',
				'What: 30 min chat',
				'When: Mon 9am',
				'',
				'Reschedule: https://x/resched',
				'Cancel: https://x/cancel'
			].join('\n')
		);
	});
});
