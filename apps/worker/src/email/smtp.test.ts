import { describe, expect, test, vi } from 'vitest';
import type { WhenConfiguration } from '@when/config';
import { createMailer, isSecurePort } from './smtp.js';
import { createLogger } from '../services/logger.js';

const createTransport = vi.fn(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({
	default: { createTransport: (...args: unknown[]) => createTransport(...args) }
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
	return createTransport.mock.calls[0][0] as { secure: boolean; requireTLS: boolean };
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
