import { expect, test } from 'vitest';
import { senderEmail } from './sender.js';
import type { WhenConfiguration } from './schema.js';

function cfg(over: {
	from?: string;
	app?: string;
	host?: string;
}): Pick<WhenConfiguration, 'smtp' | 'url'> {
	return {
		smtp: { host: over.host ?? 'smtp.test', port: 587, user: 'u', pass: 'p', from: over.from },
		url: { app: over.app ?? 'https://book.acme.com', internal: '' }
	} as Pick<WhenConfiguration, 'smtp' | 'url'>;
}

test('uses the configured smtp.from verbatim when present', () => {
	expect(senderEmail(cfg({ from: 'hello@acme.com' }))).toBe('hello@acme.com');
});

test('defaults to noreply@ the app domain', () => {
	expect(senderEmail(cfg({ app: 'https://book.acme.com' }))).toBe('noreply@book.acme.com');
});

test('parses the app domain even without a scheme', () => {
	expect(senderEmail(cfg({ app: 'book.acme.com:3000' }))).toBe('noreply@book.acme.com');
});

test('falls back to the smtp host when the app url is unusable', () => {
	expect(senderEmail(cfg({ app: '', host: 'mail.acme.com' }))).toBe('noreply@mail.acme.com');
});
