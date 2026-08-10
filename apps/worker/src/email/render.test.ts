import { describe, expect, test } from 'vitest';
import { renderHtmlBody, renderMessage, renderTextBody } from './render.js';
import { emailTheme } from './theme.js';
import type { Appearance } from '@when/config';
import type { EmailContent } from './content.js';
import type { Attachment } from './recipients.js';

const theme = emailTheme({
	background_light_color: '#f5f5f5',
	text_light_color: '#171717'
} as Appearance);

const base: Omit<EmailContent, 'actions'> = {
	brand: {
		name: 'Acme',
		appUrl: 'https://when.example.com',
		primaryColor: '#2563eb',
		onPrimary: '#ffffff'
	},
	subject: 'Confirmed appointment',
	heading: 'Hello & welcome',
	paragraphs: ['Thanks for scheduling.'],
	rows: [
		{ label: 'What', value: '30 min chat' },
		{ label: 'When', value: 'Mon 9am' },
		{ label: 'Where', value: null }
	]
};

describe('renderHtmlBody', () => {
	test('no actions: shell + heading + body, no buttons and no brand color', () => {
		const html = renderHtmlBody({ ...base, actions: [] }, theme);
		expect(html.toLowerCase()).toContain('<!doctype html');
		expect(html).not.toContain('#2563eb');
		expect(html).toContain('Hello &amp; welcome');
		expect(html).toContain('Thanks for scheduling.');
		expect(html).toContain('30 min chat');
		expect(html).not.toContain('>Where<');
		expect(html).not.toContain('mso-padding-alt');
	});

	test('renders a button per action with its href and label', () => {
		const html = renderHtmlBody(
			{
				...base,
				actions: [
					{ href: 'https://x/resched', label: 'Reschedule' },
					{ href: 'https://x/cancel', label: 'Cancel' }
				]
			},
			theme
		);
		expect(html).toContain('https://x/resched');
		expect(html).toContain('Reschedule');
		expect(html).toContain('https://x/cancel');
		expect(html).toContain('Cancel');
	});

	test('primary button uses the brand color', () => {
		const html = renderHtmlBody(
			{
				...base,
				actions: [{ href: 'https://x/review', label: 'Review request' }]
			},
			theme
		);
		expect(html).toContain('https://x/review');
		expect(html).toContain('Review request');
		expect(html).toContain('#2563eb');
	});

	test('uses the logo image when configured', () => {
		const html = renderHtmlBody(
			{
				...base,
				actions: [],
				brand: { ...base.brand, logoUrl: 'https://cdn/logo.png' }
			},
			theme
		);
		expect(html).toContain('https://cdn/logo.png');
	});
});

describe('the brand appears once, on the action', () => {
	const content: EmailContent = {
		...base,
		actions: [{ href: 'https://x/review', label: 'Review request' }]
	};
	const branded: EmailContent = {
		...content,
		brand: { ...base.brand, logoUrl: 'cid:brand-logo' }
	};

	test('the brand color reaches the button and nothing else', () => {
		const html = renderHtmlBody(content, theme);
		expect(html.match(/#2563eb/g)).toHaveLength(2);
	});

	test('the footer carries the icon, and the name only as its alt text', () => {
		const html = renderHtmlBody(branded, theme);
		expect(html).toContain('cid:brand-logo');
		expect(html).toContain('https://when.example.com');
		expect(html.match(/Acme/g)).toHaveLength(1);
	});

	test('drops the separator when there is no icon to pair it with', () => {
		expect(renderHtmlBody(branded, theme)).toContain('&middot;');
		expect(renderHtmlBody(content, theme)).not.toContain('&middot;');
	});

	test('long detail labels wrap instead of forcing the table wider', () => {
		const html = renderHtmlBody(content, theme);
		expect(html).not.toContain('white-space: nowrap');
		expect(html).toContain('width="35%"');
	});
});

describe('renderTextBody', () => {
	test('composes heading, paragraphs, rows, and actions', () => {
		const text = renderTextBody({
			...base,
			actions: [
				{ href: 'https://x/resched', label: 'Reschedule' },
				{ href: 'https://x/cancel', label: 'Cancel' }
			]
		});
		expect(text).toBe(
			[
				'Hello & welcome',
				'',
				'Thanks for scheduling.',
				'',
				'What: 30 min chat',
				'When: Mon 9am',
				'',
				'Reschedule: https://x/resched',
				'Cancel: https://x/cancel',
				'',
				'--',
				'Acme',
				'https://when.example.com'
			].join('\n')
		);
	});
});

describe('renderMessage', () => {
	const content: EmailContent = { ...base, actions: [] };
	const ics: Attachment = {
		filename: 'invite.ics',
		content: 'BEGIN:VCALENDAR',
		contentType: 'text/calendar'
	};
	const logo: Attachment = {
		filename: 'logo.png',
		content: 'aGk=',
		contentType: 'image/png',
		cid: 'brand-logo'
	};

	test('renders subject + html + text from the content, no attachments', () => {
		const env = renderMessage({ to: 'a@b.c', content }, null, theme);
		expect(env.to).toBe('a@b.c');
		expect(env.subject).toBe('Confirmed appointment');
		expect(env.html).toContain('Hello &amp; welcome');
		expect(env.text).toContain('Hello & welcome');
		expect(env.attachments).toBeUndefined();
	});

	test('attaches ics first, then logo', () => {
		const env = renderMessage({ to: 'a@b.c', content, ics }, logo, theme);
		expect(env.attachments).toEqual([ics, logo]);
	});

	test('ics-only and logo-only each attach just the one', () => {
		expect(renderMessage({ to: 'a@b.c', content, ics }, null, theme).attachments).toEqual([ics]);
		expect(renderMessage({ to: 'a@b.c', content }, logo, theme).attachments).toEqual([logo]);
	});
});
