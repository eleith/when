import { describe, expect, test, vi } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import { createMailer, isSecurePort } from './smtp.js';
import { createLogger } from '../services/logger.js';

interface TransportOptions {
	secure: boolean;
	requireTLS: boolean;
}

interface FakeTransport {
	sendMail: (message: unknown) => unknown;
}

const createTransport = vi.fn(
	(_options: TransportOptions): FakeTransport => ({
		sendMail: () => undefined
	})
);

// The factory is hoisted above createTransport, so it can only call it lazily.
vi.mock('nodemailer', () => ({
	default: { createTransport: (options: TransportOptions) => createTransport(options) }
}));

function mailerForPort(port: number) {
	createTransport.mockClear();
	createMailer(
		{
			user: { name: 'Jane Doe', email: 'owner@acme.test' },
			smtp: { host: 'smtp.test', port, user: 'u', pass: 'p' }
		} as unknown as WhenConfiguration,
		createLogger()
	);
	return createTransport.mock.calls[0][0];
}

describe('smtp', () => {
	test('465 connects with implicit TLS and leaves STARTTLS alone', () => {
		expect(mailerForPort(465)).toMatchObject({ secure: true, requireTLS: false });
	});

	test.for([587, 25])('%i refuses to fall back to cleartext', (port) => {
		expect(mailerForPort(port)).toMatchObject({ secure: false, requireTLS: true });
	});

	test('isSecurePort is true only for 465', () => {
		expect(isSecurePort(465)).toBe(true);
		expect(isSecurePort(587)).toBe(false);
		expect(isSecurePort(25)).toBe(false);
	});

	test('createMailer builds a mailer from the smtp config', () => {
		const mailer = createMailer(
			{
				user: { name: 'Jane Doe', email: 'owner@acme.test' },
				smtp: { host: 'smtp.test', port: 587, user: 'u', pass: 'p' }
			} as unknown as WhenConfiguration,
			createLogger()
		);
		expect(typeof mailer.send).toBe('function');
	});
});
