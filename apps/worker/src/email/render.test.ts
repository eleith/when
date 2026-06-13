import { describe, expect, test } from 'vitest';
import { renderHtmlBody, renderMessage, renderTextBody } from './render.js';
import type { EmailContent } from './content.js';
import type { Attachment } from './recipients.js';

const base: Omit<EmailContent, 'actions'> = {
	brand: { name: 'Acme', pageTitle: 'Acme', primaryColor: '#2563eb', onPrimary: '#ffffff' },
	subject: 'Confirmed booking',
	heading: 'Hello & welcome',
	paragraphs: ['Thanks for booking.'],
	rows: [
		{ label: 'What', value: '30 min chat' },
		{ label: 'When', value: 'Mon 9am' },
		{ label: 'Where', value: null }
	]
};

describe('renderHtmlBody', () => {
	test('no actions: shell + header + heading + body, no buttons', () => {
		const html = renderHtmlBody({ ...base, actions: [] });
		expect(html.toLowerCase()).toContain('<!doctype html');
		expect(html).toContain('#2563eb');
		expect(html).toContain('Hello &amp; welcome');
		expect(html).toContain('Thanks for booking.');
		expect(html).toContain('30 min chat');
		expect(html).not.toContain('>Where<');
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
			brand: {
				name: 'Acme',
				pageTitle: 'Acme',
				primaryColor: '#2563eb',
				onPrimary: '#ffffff',
				logoUrl: 'https://cdn/logo.png'
			}
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
				'Acme',
				'',
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
		const env = renderMessage({ to: 'a@b.c', content }, null);
		expect(env.to).toBe('a@b.c');
		expect(env.subject).toBe('Confirmed booking');
		expect(env.html).toContain('Hello &amp; welcome');
		expect(env.text).toContain('Hello & welcome');
		expect(env.attachments).toBeUndefined();
	});

	test('attaches ics first, then logo', () => {
		const env = renderMessage({ to: 'a@b.c', content, ics }, logo);
		expect(env.attachments).toEqual([ics, logo]);
	});

	test('ics-only and logo-only each attach just the one', () => {
		expect(renderMessage({ to: 'a@b.c', content, ics }, null).attachments).toEqual([ics]);
		expect(renderMessage({ to: 'a@b.c', content }, logo).attachments).toEqual([logo]);
	});
});
