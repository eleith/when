import { describe, expect, test } from 'vitest';
import { testEmailMessage } from './test-email.js';
import { renderMessage } from '../render.js';
import { emailTheme } from '../theme.js';
import { sampleConfig } from '../__fixtures__/appointment.js';

describe('testEmailMessage', () => {
	test('addresses the recipient and builds test content', () => {
		const msg = testEmailMessage(sampleConfig, 'me@example.com', null);
		expect(msg.to).toBe('me@example.com');
		expect(msg.content.subject).toContain('Test email');
		expect(msg.content.heading).toContain('test email from When');
		expect(msg.content.actions).toEqual([
			{ href: 'https://when.example.com', label: 'Open your booking page' }
		]);
	});

	test('the rows report the send and stress the widest label the table can get', () => {
		const at = Temporal.Instant.from('2026-01-05T15:00:00Z');
		const rows = testEmailMessage(sampleConfig, 'me@example.com', null, at).content.rows;
		expect(rows.map((r) => r.label)).toEqual([
			'Sent to',
			'Sent at',
			'Sends as',
			'What would you like to discuss in our meeting?'
		]);
		expect(rows[0].value).toBe('me@example.com');
		expect(rows[1].value).toBe('Jan 5, 2026, 10:00 AM (GMT-5)');
		expect(rows[2].value).toBe('noreply@when.example.com');
	});

	test('renders html + text through the real pipeline and attaches the logo', () => {
		const logo = {
			filename: 'logo.png',
			content: 'x',
			contentType: 'image/png',
			cid: 'brand-logo'
		};
		const envelope = renderMessage(
			testEmailMessage(sampleConfig, 'me@example.com', logo),
			logo,
			emailTheme(sampleConfig.user.appearance)
		);
		expect(envelope.to).toBe('me@example.com');
		expect(envelope.html).toContain('test email from When');
		expect(envelope.text).toContain('When can render and send email');
		expect(envelope.attachments).toEqual([logo]);
	});
});
