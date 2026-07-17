import { describe, expect, test } from 'vitest';
import { testEmailMessage } from './test-email.js';
import { renderMessage } from '../render.js';
import { sampleConfig } from '../__fixtures__/appointment.js';

describe('testEmailMessage', () => {
	test('addresses the recipient and builds test content', () => {
		const msg = testEmailMessage(sampleConfig, 'me@example.com', null);
		expect(msg.to).toBe('me@example.com');
		expect(msg.content.subject).toContain('Test email');
		expect(msg.content.heading).toContain('test email from When');
	});

	test('renders html + text through the real pipeline and attaches the logo', () => {
		const logo = {
			filename: 'logo.png',
			content: 'x',
			contentType: 'image/png',
			cid: 'brand-logo'
		};
		const envelope = renderMessage(testEmailMessage(sampleConfig, 'me@example.com', logo), logo);
		expect(envelope.to).toBe('me@example.com');
		expect(envelope.html).toContain('test email from When');
		expect(envelope.text).toContain('When can render and send email');
		expect(envelope.attachments).toEqual([logo]);
	});
});
